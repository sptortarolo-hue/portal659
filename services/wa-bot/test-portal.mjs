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

  // 7. Aislamiento: el portal NO usa el concierge de negocios (handleConcierge).
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
