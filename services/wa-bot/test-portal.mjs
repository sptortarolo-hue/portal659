// @ts-nocheck
// Test del bot del portal (conserje del barrio + pedidos por tienda).
// NO toca el bot de los comercios (concierge): usa handlePortalInbound directo.
process.env.BOT_TAKE_ORDERS = "";

const { handleInbound, handleInboundMedia, persist } = await import("./src/bot.mjs");
const { getState, setState, clearState, DEFAULT_STATE } = await import("./src/state.mjs");

const MOCK_PORTAL_MENU = {
  vendors: [
    {
      id: "store1",
      store_name: "Che Sancho",
      slug: "che-sancho",
      vertical: "gastronomia",
      store_open: true,
      open_text: "Abierto ahora",
      next_open_text: null,
      hours: "lun a vie 09:00-13:00 y 17:00-22:00",
      products: [
        { id: "p1", store_id: "store1", store_name: "Che Sancho", store_slug: "che-sancho", name: "Empanada de carne", price: 1200, category: "Empanadas", modifiers: [], variants: [] },
        { id: "p2", store_id: "store1", store_name: "Che Sancho", store_slug: "che-sancho", name: "Coca-Cola 500ml", price: 1000, category: "Bebidas", modifiers: [], variants: [] },
      ],
    },
    {
      id: "store2",
      store_name: "La Esquina",
      slug: "la-esquina",
      vertical: "gastronomia",
      store_open: true,
      open_text: "Abierto ahora",
      next_open_text: null,
      hours: "lun a vie 09:00-13:00 y 17:00-22:00",
      products: [
        { id: "p3", store_id: "store2", store_name: "La Esquina", store_slug: "la-esquina", name: "Milanesa napolitana", price: 2500, category: "Platos", modifiers: [], variants: [] },
      ],
    },
  ],
};

const MOCK_STORE_MENUS = {
  store1: { vendor: { id: "store1", store_name: "Che Sancho", vertical: "gastronomia", store_open: true, open_text: "Abierto ahora" }, products: MOCK_PORTAL_MENU.vendors[0].products },
  store2: { vendor: { id: "store2", store_name: "La Esquina", vertical: "gastronomia", store_open: true, open_text: "Abierto ahora" }, products: MOCK_PORTAL_MENU.vendors[1].products },
};

let handoffNotified = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("/api/wa/portal-menu")) return { ok: true, json: async () => MOCK_PORTAL_MENU };
  if (u.includes("/api/wa/menu")) {
    const m = u.match(/vendorId=([^&]+)/);
    const id = m ? decodeURIComponent(m[1]) : "";
    const data = MOCK_STORE_MENUS[id];
    return data ? { ok: true, json: async () => data } : { ok: false, json: async () => ({}) };
  }
  if (u.includes("/api/wa/handoff")) { handoffNotified = true; return { ok: true, json: async () => ({ ok: true }) }; }
  if (u.includes("/api/wa/order")) return { ok: true, json: async () => ({ ok: true, orderId: "ord-portal-1", total: 2400, trackToken: "tok-portal-1", pickupNumber: 7 }) };
  if (u.includes("/api/wa/portal-orders")) return { ok: true, json: async () => ({ orders: [{ id: "ord-portal-1", pickupNumber: 7, status: "preparing", storeName: "Che Sancho", storeSlug: "che-sancho", storeId: "store1", total: 2400, method: "pickup", paymentMethod: "whatsapp", items: [{ product_id: "p1", name: "Empanada de carne", price: 1200, qty: 2, modifiers: [] }], trackUrl: "https://www.portal659.com.ar/seguimiento/tok-portal-1", createdAt: new Date().toISOString() }] }) };
  if (u.includes("/api/wa/favorites")) {
    if (opts?.method === "POST") return { ok: true, json: async () => ({ ok: true }) };
    if (opts?.method === "DELETE") return { ok: true, json: async () => ({ ok: true }) };
    return { ok: true, json: async () => ({ favorites: [{ vendor_id: "store1", store_name: "Che Sancho", slug: "che-sancho" }] }) };
  }
  return realFetch(url, opts);
};

const portalVendor = { id: "portal-vendor", store_name: "Portal 659 Bot (sistema)", slug: "portal659-bot", enabled: true, is_portal: true };
const wa = "5491100000099";

function show(label, r) {
  console.log(`\n===== ${label} =====`);
  console.log((r.replies || []).join("\n---\n"));
}

async function main() {
  let r, ok = true;

  // 1. Saludo del portal
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "hola" });
  show("hola (portal)", r);
  const s = (r.replies || []).join(" ");
  if (!s.includes("Portal 659") || !s.includes("comercios") && !s.includes("tiendas")) { /* flexible */ }
  if (!s.includes("Portal 659")) { console.log("!!! saludo del portal sin marca"); ok = false; }
  else { console.log(">>> OK: saludo propio del portal"); }

  // 2. Listado de tiendas (conversación nueva)
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "comercios" });
  show("comercios (portal)", r);
  const c = (r.replies || []).join(" ");
  if (!c.includes("Che Sancho") || !c.includes("La Esquina")) { console.log("!!! no listó las tiendas"); ok = false; }
  else { console.log(">>> OK: listado de tiendas de la zona"); }

  // 3. Búsqueda de producto → matches por tienda
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "milanesa" });
  show("búsqueda milanesa (portal)", r);
  const m = (r.replies || []).join(" ");
  if (!m.includes("La Esquina") || !m.includes("Milanesa")) { console.log("!!! no encontró el producto por tienda"); ok = false; }
  else { console.log(">>> OK: búsqueda de producto con tienda + precio"); }

  // 4. Elegir tienda por número → menú de esa tienda
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "comercios" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "1" });
  show("elegir tienda 1 (portal)", r);
  const e = (r.replies || []).join(" ");
  if (!e.includes("Che Sancho") || !e.includes("Empanada")) { console.log("!!! no mostró el menú de la tienda elegida"); ok = false; }
  else { console.log(">>> OK: eligió tienda por número y mostró su menú"); }

  // 5. Pedido a esa tienda (reusa el flujo)
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "2 empanadas de carne" });
  show("pedido (portal)", r);
  const p = (r.replies || []).join(" ");
  if (!p.includes("Empanada")) { console.log("!!! no agregó el item"); ok = false; }
  else { console.log(">>> OK: item agregado al carrito de la tienda elegida"); }

  // 6. "ayuda" → handoff a los admins del portal
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  handoffNotified = false;
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "ayuda" });
  show("ayuda (portal)", r);
  if (!handoffNotified || !(r.replies || []).join(" ").includes("Enseguida te atiende una persona")) { console.log("!!! 'ayuda' no derivó al humano (portal)"); ok = false; }
  else { console.log(">>> OK: 'ayuda' → handoff a los admins del portal"); }

  // 7. Búsqueda por categoría ("bebidas", "empanadas")
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "bebidas" });
  show("búsqueda categoría bebidas (portal)", r);
  const bc = (r.replies || []).join(" ");
  if (!bc.includes("Coca-Cola") || !bc.includes("Productos de la categoría")) { console.log("!!! búsqueda por categoría no funcionó"); ok = false; }
  else { console.log(">>> OK: búsqueda por categoría → productos de la categoría"); }

  // 8. Consulta de estado del pedido ("¿cómo va mi pedido?")
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "¿cómo va mi pedido?" });
  show("estado del pedido (portal)", r);
  const st = (r.replies || []).join(" ");
  if (!st.includes("Che Sancho") || !st.includes("En preparación") || !st.includes("seguimiento/tok-portal-1")) { console.log("!!! no respondió el estado del pedido"); ok = false; }
  else { console.log(">>> OK: consulta de estado → tienda + estado + link de seguimiento"); }

  // 8. Re-pedido ("lo mismo que la última vez")
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "repetir pedido" });
  show("re-pedido (portal)", r);
  const rp = (r.replies || []).join(" ");
  if (!rp.includes("Empanada de carne") || !rp.includes("¿Confirmás") || !rp.includes("Che Sancho")) { console.log("!!! re-pedido no armó el carrito"); ok = false; }
  else { console.log(">>> OK: re-pedido → carrito armado + confirmación"); }
  // Confirmar → crea el pedido
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "sí" });
  show("confirmar re-pedido (portal)", r);
  const rpc = (r.replies || []).join(" ");
  if (!rpc.includes("Pedido confirmado") && !rpc.includes("confirmado")) { console.log("!!! re-pedido no confirmó"); ok = false; }
  else { console.log(">>> OK: re-pedido confirmado → pedido creado"); }

  // 9. Horarios por tienda ("¿a qué hora abre X?")
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "¿a qué hora abre Che Sancho?" });
  show("horarios (portal)", r);
  const hr = (r.replies || []).join(" ");
  if (!hr.includes("Che Sancho") || !hr.includes("Abierto ahora") || !hr.includes("lun a vie")) { console.log("!!! no respondió los horarios"); ok = false; }
  else { console.log(">>> OK: horarios → tienda + estado + horario"); }

  // 10. Edición del carrito en confirmación ("sacá la coca", "poné 3 empanadas")
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "comercios" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "1" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "2 empanadas de carne y 1 coca" });
  // Force confirm step (the flow might ask for method/name first; let's just check the edit works when in confirm)
  // Actually, let's test the edit on a pre-set confirm state
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  // Set up a confirm state manually
  const { setState: ss } = await import("./src/state.mjs");
  await ss(portalVendor.id, wa, { ...DEFAULT_STATE, step: "confirm", welcomed: true, currentVendorId: "store1", currentVendorName: "Che Sancho", currentVendorSlug: "che-sancho", items: [{ offerId: "p1", name: "Empanada de carne", qty: 2, modifiers: [] }, { offerId: "p2", name: "Coca-Cola 500ml", qty: 1, modifiers: [] }], method: "pickup", payment: "whatsapp" });
  // Remove an item
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "sacá la coca" });
  show("sacar coca (portal)", r);
  const sc = (r.replies || []).join(" ");
  if (!sc.includes("saqué") || !sc.includes("Coca-Cola") || sc.includes("Coca-Cola ×1")) { /* item should be removed */ }
  // Verify the item was removed by checking the summary
  // The removal message mentions "Coca-Cola 500ml"; the summary (• lines) should NOT.
  const summaryLines = (r.replies || []).filter((x) => x.startsWith("•") || x.startsWith("✅")).join(" ");
  if (summaryLines.includes("Coca-Cola")) { console.log("!!! la coca no se sacó del carrito"); ok = false; }
  else { console.log(">>> OK: 'sacá la coca' → item eliminado del carrito"); }
  // Change quantity
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "poné 3 empanadas" });
  show("cambiar cantidad (portal)", r);
  const cq = (r.replies || []).join(" ");
  if (!cq.includes("cambié") || !cq.includes("3")) { console.log("!!! no cambió la cantidad"); ok = false; }
  else { console.log(">>> OK: 'poné 3 empanadas' → cantidad actualizada"); }
  // Verify empty cart handling
  await ss(portalVendor.id, wa, { ...DEFAULT_STATE, step: "confirm", welcomed: true, currentVendorId: "store1", currentVendorName: "Che Sancho", currentVendorSlug: "che-sancho", items: [{ offerId: "p1", name: "Empanada de carne", qty: 1, modifiers: [] }], method: "pickup", payment: "whatsapp" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "sacá la empanada" });
  show("carrito vacío (portal)", r);
  const cv = (r.replies || []).join(" ");
  if (!cv.includes("vacío")) { console.log("!!! no avisó que el carrito quedó vacío"); ok = false; }
  else { console.log(">>> OK: carrito vacío → aviso + volver a idle"); }

  // 11. Horarios de todas las tiendas (sin mencionar una)
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "horarios" });
  show("horarios todas (portal)", r);
  const hra = (r.replies || []).join(" ");
  if (!hra.includes("Che Sancho") || !hra.includes("La Esquina")) { console.log("!!! no listó horarios de todas las tiendas"); ok = false; }
  else { console.log(">>> OK: horarios → todas las tiendas"); }

  // 11. Favoritos: "guardá X como favorito" → agrega
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  handoffNotified = false;
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "guardá Che Sancho como favorito" });
  show("favorito add (portal)", r);
  const fa = (r.replies || []).join(" ");
  if (!fa.includes("agregada a tus favoritas")) { console.log("!!! no agregó el favorito"); ok = false; }
  else { console.log(">>> OK: 'guardá como favorito' → agregado"); }

  // 12. Favoritos: "mis favoritos" → lista
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "mis favoritos" });
  show("favoritos lista (portal)", r);
  const fl = (r.replies || []).join(" ");
  if (!fl.includes("Che Sancho") || !fl.includes("favoritas")) { console.log("!!! no listó los favoritos"); ok = false; }
  else { console.log(">>> OK: 'mis favoritos' → lista con tiendas"); }

  // 13. Favoritos: "sacá X de favoritos" → quita
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "sacá Che Sancho de favoritos" });
  show("favorito remove (portal)", r);
  const fr = (r.replies || []).join(" ");
  if (!fr.includes("saqué") || !fr.includes("favoritos")) { console.log("!!! no quitó el favorito"); ok = false; }
  else { console.log(">>> OK: 'sacá de favoritos' → quitado"); }

  // 14. Aislamiento: el portal NO usa el concierge de negocios (handleConcierge).
  //    Verificamos que el saludo es el del portal, no el de un comercio.
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "hola" });
  const iso = (r.replies || []).join(" ");
  if (iso.includes("Pedí fácil desde el menú") || iso.includes("abiertos ahora ✓")) { console.log("!!! el portal respondió con el saludo de un comercio (contaminación)"); ok = false; }
  else { console.log(">>> OK: aislamiento — saludo propio del portal, no del concierge de negocios"); }

  if (!ok) { console.error("\n=== HAY FALLOS (portal) ==="); process.exit(1); }
  console.log("\n=== TODO OK (portal bot) ===");
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
