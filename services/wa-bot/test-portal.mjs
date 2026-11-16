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
        { id: "p1", store_id: "store1", store_name: "Che Sancho", store_slug: "che-sancho", name: "Empanada de carne", price: 1200, category: "Empanadas", modifiers: [], variants: [], image_url: "https://www.portal659.com.ar/uploads/test-empanada.jpg", featured_today: true },
        { id: "p2", store_id: "store1", store_name: "Che Sancho", store_slug: "che-sancho", name: "Coca-Cola 500ml", price: 1000, category: "Bebidas", modifiers: [], variants: [], image_url: null, featured_today: false },
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
    {
      id: "store3",
      store_name: "Estética Serena",
      slug: "estetica-serena",
      vertical: "estetica",
      store_open: true,
      open_text: "Abierto ahora",
      next_open_text: null,
      hours: "lun a vie 10:00-19:00",
      products: [],
    },
    {
      id: "store4",
      store_name: "Kiosco Rota",
      slug: "kiosco-rota",
      vertical: "comercio",
      store_open: true,
      open_text: "Abierto ahora",
      next_open_text: null,
      hours: "lun a vie 08:00-13:00",
      products: [
        { id: "p4", store_id: "store4", store_name: "Kiosco Rota", store_slug: "kiosco-rota", name: "Alfajor triple", price: 1500, category: "Golosinas", modifiers: [], variants: [] },
      ],
    },
    {
      id: "store5",
      store_name: "Oasis",
      slug: "oasis",
      vertical: "gastronomia",
      store_open: true,
      open_text: "Abierto ahora",
      next_open_text: null,
      hours: "lun a vie 09:00-23:00",
      products: [
        { id: "p10", store_id: "store5", store_name: "Oasis", store_slug: "oasis", name: "Empanada de Carne", price: 1100, category: "Empanadas", modifiers: [], variants: [] },
        { id: "p11", store_id: "store5", store_name: "Oasis", store_slug: "oasis", name: "Empanada de Pollo", price: 1000, category: "Empanadas", modifiers: [], variants: [] },
        { id: "p12", store_id: "store5", store_name: "Oasis", store_slug: "oasis", name: "Empanada de Jamón y queso", price: 1300, category: "Empanadas", modifiers: [], variants: [] },
        { id: "p13", store_id: "store5", store_name: "Oasis", store_slug: "oasis", name: "Empanada Humita", price: 1200, category: "Empanadas", modifiers: [], variants: [] },
        { id: "p14", store_id: "store5", store_name: "Oasis", store_slug: "oasis", name: "Empanada de Verdura", price: 1100, category: "Empanadas", modifiers: [], variants: [] },
        { id: "p15", store_id: "store5", store_name: "Oasis", store_slug: "oasis", name: "Empanada Capuchino", price: 1400, category: "Empanadas", modifiers: [], variants: [] },
        { id: "p16", store_id: "store5", store_name: "Oasis", store_slug: "oasis", name: "Empanada Bocadito", price: 1500, category: "Empanadas", modifiers: [], variants: [] },
        { id: "p17", store_id: "store5", store_name: "Oasis", store_slug: "oasis", name: "Empanada de Cebolla", price: 1150, category: "Empanadas", modifiers: [], variants: [] },
        { id: "p18", store_id: "store5", store_name: "Oasis", store_slug: "oasis", name: "Coca-Cola 500", price: 1000, category: "Bebidas", modifiers: [], variants: [] },
        { id: "p19", store_id: "store5", store_name: "Oasis", store_slug: "oasis", name: "Sprite 500", price: 950, category: "Bebidas", modifiers: [], variants: [] },
        { id: "p20", store_id: "store5", store_name: "Oasis", store_slug: "oasis", name: "Agua mineral", price: 800, category: "Bebidas", modifiers: [], variants: [] },
        { id: "p21", store_id: "store5", store_name: "Oasis", store_slug: "oasis", name: "Promo docena", price: 11000, category: "Promos", modifiers: [], variants: [] },
        { id: "p22", store_id: "store5", store_name: "Oasis", store_slug: "oasis", name: "Promo media docena", price: 6200, category: "Promos", modifiers: [], variants: [] },
      ],
    },
  ],
};

const MOCK_STORE_MENUS = {
  store1: { vendor: { id: "store1", store_name: "Che Sancho", vertical: "gastronomia", store_open: true, open_text: "Abierto ahora" }, products: MOCK_PORTAL_MENU.vendors[0].products },
  store2: { vendor: { id: "store2", store_name: "La Esquina", vertical: "gastronomia", store_open: true, open_text: "Abierto ahora" }, products: MOCK_PORTAL_MENU.vendors[1].products },
  // Estética Sinergia: catálogo vacío (tienda de turnos, no de productos)
  store3: { vendor: { id: "store3", store_name: "Estética Serena", vertical: "estetica", store_open: true, open_text: "Abierto ahora" }, products: [] },
  // Oasis (grande): 13 productos en 3 secciones
  store5: { vendor: { id: "store5", store_name: "Oasis", vertical: "gastronomia", store_open: true, open_text: "Abierto ahora" }, products: MOCK_PORTAL_MENU.vendors[4].products },
  // store4 ("Kiosco Rota") NO está acá: /api/wa/menu responde 500 → error real
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
  if (u.includes("/api/wa/portal-orders")) return { ok: true, json: async () => ({ orders: [{ id: "ord-portal-1", pickupNumber: 7, status: "preparing", storeName: "Che Sancho", storeSlug: "che-sancho", storeId: "store1", total: 2400, method: "pickup", paymentMethod: "whatsapp", customerName: "María García", items: [{ product_id: "p1", name: "Empanada de carne", price: 1200, qty: 2, modifiers: [] }], trackUrl: "https://www.portal659.com.ar/seguimiento/tok-portal-1", createdAt: new Date().toISOString() }] }) };
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
  if (!rp.includes("Empanada de carne") || !rp.includes("¿Lo pedís de nuevo?") || !rp.includes("Che Sancho")) { console.log("!!! re-pedido no armó el carrito"); ok = false; }
  else { console.log(">>> OK: re-pedido → carrito armado + confirmación"); }
  // Confirmar → crea el pedido (el mock ya tiene customerName, así que va directo a confirmar)
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

  // 15. Capa informativa: el menú corto y el "no pedido sin tienda".
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "hola" });
  show("menú corto (portal)", r);
  const menu = (r.replies || []).join(" ");
  if (!menu.includes("1️⃣") || !menu.includes("Ver tiendas abiertas") || !menu.includes("Sumalo gratis")) { console.log("!!! el saludo no mostró el menú corto de 5 opciones"); ok = false; }
  else if (menu.includes("Che Sancho (2 productos)")) { console.log("!!! el saludo tiró el listado largo en vez del menú"); ok = false; }
  else { console.log(">>> OK: saludo → menú corto informativo (sin listado largo)"); }

  // 15b. Opción 1: tiendas abiertas, con link al micrositio.
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "1" });
  show("opción 1 tiendas abiertas (portal)", r);
  const o1 = (r.replies || []).join(" ");
  if (!o1.includes("/tienda/che-sancho") || !o1.includes("Che Sancho")) { console.log("!!! la opción 1 no mostró las tiendas abiertas con link"); ok = false; }
  else { console.log(">>> OK: opción 1 → tiendas abiertas con link al micrositio"); }

  // 15c. Opción 3: cómo comprar / pagar.
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "3" });
  show("opción 3 cómo comprar (portal)", r);
  const o3 = (r.replies || []).join(" ");
  if (!o3.includes("Mercado Pago") || !o3.includes("Efectivo")) { console.log("!!! la opción 3 no explicó cómo comprar/pagar"); ok = false; }
  else { console.log(">>> OK: opción 3 → cómo comprar / pagar"); }

  // 15d. Opción 4: B2B (sumar comercio).
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "4" });
  show("opción 4 B2B (portal)", r);
  const o4 = (r.replies || []).join(" ");
  if (!o4.includes("0% comisión") || !o4.includes("Básico")) { console.log("!!! la opción 4 no mostró el contenido B2B"); ok = false; }
  else { console.log(">>> OK: opción 4 → B2B con planes y 0% comisión"); }

  // 15e. B2B por texto ("tengo un comercio").
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "tengo un comercio y quiero sumarlo" });
  show("B2B por texto (portal)", r);
  const o4b = (r.replies || []).join(" ");
  if (!o4b.includes("0% comisión")) { console.log("!!! 'tengo un comercio' no derivó al contenido B2B"); ok = false; }
  else { console.log(">>> OK: 'tengo un comercio' → contenido B2B"); }

  // 15f. Opción 5: persona.
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  handoffNotified = false;
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "5" });
  show("opción 5 persona (portal)", r);
  if (!handoffNotified) { console.log("!!! la opción 5 no derivó a una persona"); ok = false; }
  else { console.log(">>> OK: opción 5 → handoff a una persona"); }

  // 15g. REGLA DE ORO: pedido SIN tienda elegida → muestra tiendas, no crea pedido.
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "quiero pedir empanadas" });
  show("pedido sin tienda (portal)", r);
  const o5 = (r.replies || []).join(" ");
  if (o5.includes("Pedido confirmado") || o5.includes("Tu pedido:") || o5.includes("¿Todo bien?")) { console.log("!!! armó un pedido sin que el cliente eligiera tienda"); ok = false; }
  else if (!o5.includes("Che Sancho")) { console.log("!!! no ofreció las tiendas donde pedir"); ok = false; }
  else { console.log(">>> OK: pedido sin tienda elegida → muestra tiendas, NO crea pedido"); }

  // 15h. "qué hay abierto" → tiendas abiertas.
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "qué hay abierto?" });
  show("qué hay abierto (portal)", r);
  const o6 = (r.replies || []).join(" ");
  if (!o6.includes("/tienda/")) { console.log("!!! 'qué hay abierto' no listó tiendas con link"); ok = false; }
  else { console.log(">>> OK: 'qué hay abierto' → tiendas abiertas con link"); }

  // 16. Tienda de servicios (sin catálogo): CTA a micrositio, NO "no tiene productos".
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "1" });
  show("tiendas (para elegir servicios)", r);
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "3" });
  show("elegir Estética Serena (servicios)", r);
  const svc = (r.replies || []).join(" ");
  if (!svc.includes("/tienda/estetica-serena")) { console.log("!!! la tienda de servicios no mostró el link a su micrositio"); ok = false; }
  else if (!svc.includes("turnos")) { console.log("!!! la tienda de servicios no indicó que atiende por turnos"); ok = false; }
  else if (svc.includes("Mandame tu pedido")) { console.log("!!! a una tienda de turnos se le ofreció 'mandame tu pedido'"); ok = false; }
  else { console.log(">>> OK: tienda de servicios → CTA a micrositio + turnos (sin pedido fantasma)"); }

  // 17. Menú de tienda que FALLA (500): avisar, no mentir "no tiene productos".
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "1" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "4" });
  show("elegir tienda con menú 500", r);
  const err = (r.replies || []).join(" ");
  if (!err.includes("No pude cargar el menú")) { console.log("!!! al fallar el menú no avisó del error"); ok = false; }
  else if (err.includes("no tiene productos") || err.includes("no tiene catálogo")) { console.log("!!! al fallar el menú mintió 'sin catálogo'"); ok = false; }
  else { console.log(">>> OK: menú caído → aviso honesto (no 'sin catálogo')"); }

  // 18. Ficha de producto (Fase A): número → ficha → cantidad directa al carrito.
  const { getState } = await import("./src/state.mjs");
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "1" }); // tiendas abiertas
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "1" }); // Che Sancho
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "1" }); // ficha Empanada
  show("ficha producto 1", r);
  const f1 = (r.replies || []).join(" ");
  if (!f1.includes("Empanada de carne")) { console.log("!!! la ficha no abrió el producto"); ok = false; }
  else if (!f1.includes("Agregar al carrito")) { console.log("!!! la ficha no ofreció agregar"); ok = false; }
  else if (!f1.includes("🔥")) { console.log("!!! la ficha no marcó la oferta del día"); ok = false; }
  else { console.log(">>> OK: ficha (Empanada, oferta del día 🔥, precio)"); }
  // cantidad directa desde la ficha
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "2" });
  const stFicha = await getState(portalVendor.id, wa);
  const emp = (stFicha?.items || []).find((i) => String(i.name || "").includes("Empanada"));
  if (!emp || Number(emp.qty) !== 2) { console.log("!!! la cantidad directa (2) no se agregó a la ficha"); ok = false; }
  else { console.log(">>> OK: '2' en la ficha agrega 2 unidades al carrito"); }
  // volver desde la ficha → reimprime el catálogo
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "volver" });
  show("volver al catálogo", r);
  const f4 = (r.replies || []).join(" ");
  if (!f4.includes("Empanada") || !f4.includes("$1.200")) { console.log("!!! 'volver' no volvió al catálogo"); ok = false; }
  else { console.log(">>> OK: 'volver' reimprime el catálogo"); }

  // 19. "¿Qué te hace falta hoy?" (opción 6 → rubros → tiendas del rubro)
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "6" });
  show("opción 6 rubros (portal)", r);
  const r6 = (r.replies || []).join(" ");
  if (!r6.includes("¿Qué te hace falta hoy?")) { console.log("!!! la opción 6 no abrió los rubros"); ok = false; }
  else if (!r6.includes("Gastronomía (3")) { console.log("!!! los rubros no muestran conteo (esperado Gastronomía 3)"); ok = false; }
  else if (!r6.includes("Peluquería y Estética (1")) { console.log("!!! falta Peluquería y Estética con conteo 1"); ok = false; }
  else { console.log(">>> OK: opción 6 → rubros con conteo"); }
  // Elegir rubro 1 (gastronomía): solo tiendas del rubro
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "1" });
  show("rubro gastronomía (portal)", r);
  const r6b = (r.replies || []).join(" ");
  if (!r6b.includes("Che Sancho") || !r6b.includes("La Esquina")) { console.log("!!! el rubro no listó las gastronómicas"); ok = false; }
  else if (r6b.includes("Estética Serena")) { console.log("!!! el rubro mezcló otras verticales"); ok = false; }
  else { console.log(">>> OK: rubro → solo tiendas del rubro"); }
  // Elegir la tienda 1 del rubro → catálogo (número = ficha ya cubierto)
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "1" });
  const r6c = (r.replies || []).join(" ");
  if (!r6c.includes("Perfecto, estás pidiendo de *Che Sancho*")) { console.log("!!! la elección de tienda tras el rubro no abrió el catálogo"); ok = false; }
  else { console.log(">>> OK: rubro → tienda → catálogo"); }

  // 20. Secciones del comercio (Fase A2): catálogo grande → rubros internos.
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "1" }); // tiendas abiertas
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "5" }); // Oasis (grande)
  show("Oasis - secciones", r);
  const sec0 = (r.replies || []).join(" ");
  if (!sec0.includes("¿Qué se te antoja en *Oasis*")) { console.log("!!! la tienda grande no mostró secciones"); ok = false; }
  else if (!sec0.includes("Empanadas (8)")) { console.log("!!! falta la sección Empanadas con conteo 8"); ok = false; }
  else if (!sec0.includes("Bebidas (3)")) { console.log("!!! falta la sección Bebidas con conteo 3"); ok = false; }
  else { console.log(">>> OK: tienda grande → secciones con conteo"); }
  // Elegir sección 1 (Empanadas): solo sus productos
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "1" });
  show("Oasis - sección Empanadas", r);
  const sec1 = (r.replies || []).join(" ");
  if (!sec1.includes("Empanada de Carne")) { console.log("!!! la sección no mostró los productos"); ok = false; }
  else if (sec1.includes("Sprite") || sec1.includes("Coca-Cola")) { console.log("!!! la sección mezcló productos de otras secciones"); ok = false; }
  else { console.log(">>> OK: sección → solo productos de esa sección"); }
  // Elegir producto 1 → ficha
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "1" });
  show("Oasis - ficha desde sección", r);
  const sec2 = (r.replies || []).join(" ");
  if (!sec2.includes("Agregar al carrito")) { console.log("!!! la ficha no abrió tras elegir desde la sección"); ok = false; }
  else { console.log(">>> OK: sección → ficha del producto"); }
  // Volver a entrar y elegir "0" → todo el menú
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "inicio" });
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "1" }); // tiendas abiertas
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "5" }); // Oasis → secciones otra vez
  r = await handleInbound({ vendor: portalVendor, waId: wa, body: "0" }); // todo el menú
  show("Oasis - todo el menú", r);
  const sec3 = (r.replies || []).join(" ");
  if (!sec3.includes("Coca-Cola 500") || !sec3.includes("Empanada de Carne")) { console.log("!!! '0' no mostró todo el menú (falta Coca y Empanada)"); ok = false; }
  else { console.log(">>> OK: '0' → todo el menú"); }

  if (!ok) { console.error("\n=== HAY FALLOS (portal) ==="); process.exit(1); }
  console.log("\n=== TODO OK (portal bot) ===");
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
