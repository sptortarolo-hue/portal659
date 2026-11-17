// @ts-nocheck
// Golden conversations: replay de casos REALES de producción (bugs y cadenas
// frágiles que salieron del WhatsApp real) con assertions automáticas. Es la
// red de seguridad del bot: cada bug nuevo acá se convierte en un caso.
//
// Corre: node test-golden.mjs
process.env.BOT_TAKE_ORDERS = "";

const { handleInbound, persist } = await import("./src/bot.mjs");
const { clearState, getState } = await import("./src/state.mjs");

const NAMES = ['Boca Juniors #2','Boca juniors #1','Cerezas 🍒','Estudiantes de La Plata','Frases #1','Frutillita #1','Frutillita #2','Gatitos #1','Maradona','Mickey y Minnie','Perritos #1','River Plate','Salchi #1','Sarah kay #1','Sarah kay #2','Snoopy','Stich'];
const STICKER_NAMES = NAMES;
const MOCK_PRODUCTS = NAMES.map((n, i) => ({
  id: "sticker-" + (i + 1),
  name: n,
  price: 6000,
  category: "Planchas",
  modifiers: [],
  variants: [],
}));
const STICKER_STORE = { id: "stickers-dt", store_name: "Stickers DT", slug: "stickers-dt", vertical: "comercio", store_open: true, open_text: "Abierto", products: MOCK_PRODUCTS };

const CAFE_STORE = {
  id: "azahar", store_name: "Azahar Café ConSentido", slug: "azahar", vertical: "gastronomia", store_open: false, next_open_text: "hoy 08:30",
  products: [
    { id: "cafe", name: "Café con leche", price: 2500, category: "Bebidas / Cafes", modifiers: [], variants: [] },
    { id: "tost", name: "Tostada", price: 3200, category: "Comidas / Panaderia", modifiers: [], variants: [] },
  ],
};

const MOCK_MENU = { vendors: [STICKER_STORE, CAFE_STORE] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("/api/wa/portal-menu")) return { ok: true, json: async () => MOCK_MENU };
  if (u.includes("/api/wa/menu")) {
    const store = u.includes("stickers-dt") ? STICKER_STORE : CAFE_STORE;
    return { ok: true, json: async () => ({ vendor: store, products: store.products }) };
  }
  if (u.includes("http")) return realFetch(url, opts);
  return { ok: true, json: async () => ({}) };
};

const vendor = { id: "portal-vendor", store_name: "Portal Bot", slug: "portal659-bot", enabled: true, is_portal: true };
const wa = "5491100009876";
let failures = 0;
let checks = 0;
const condition = (label, cond) => {
  checks++;
  if (cond) console.log(">>> OK: " + label);
  else { failures++; console.log("!!! FALLA: " + label); }
};
const show = (label, r) => console.log("----- " + label + " -----\n" + (r.replies || []).join("\n").slice(0, 900) + "\n");

const send = async (body) => handleInbound({ vendor, waId: wa, body });
const textsOf = (r) => (r.replies || []).join("\n");

// =====================================================================
// 1) Notación "producto x cantidad" (regresión: '1 X3 9x2 y del 17 1 también 2 del 10')
// =====================================================================
await clearState(vendor.id, wa);
let r = await send("comercios");
await send("1"); // Stickers DT
r = await send("1 X3 9x2 y del 17 1 también 2 del 10");
show("notación X", r);
{
  const st = await getState(vendor.id, wa);
  const names = (st.items || []).map((i) => `${i.offerId} x${i.qty}`);
  console.log("     carrito:", names.join(", "));
  condition("X-notation: 4 ítems con cantidades correctas",
    (st.items || []).length === 4
    && (st.items || []).some((i) => String(i.offerId).endsWith("-1") && Number(i.qty) === 3)
    && (st.items || []).some((i) => String(i.offerId).endsWith("-9") && Number(i.qty) === 2)
    && (st.items || []).some((i) => String(i.offerId).endsWith("-17") && Number(i.qty) === 1)
    && (st.items || []).some((i) => String(i.offerId).endsWith("-10") && Number(i.qty) === 2));
}

// =====================================================================
// 2) "Podemos modificar?" — guía, no Q&A de productos
// =====================================================================
r = await send("Podemos modificar?");
show("podemos modificar", r);
{
  const t = textsOf(r);
  condition("'Podemos modificar?' → guía de edición", /sacame el|modificar|cambiar cantidad/i.test(t) === true && !/ofertas del día/i.test(t));
}

// =====================================================================
// 3) "Del de boca quiero 3 y del de cerezas 8. Sacame el de stich" — multi-edit
// =====================================================================
r = await send("Del de boca quiero 3 y del de cerezas 8. Sacame el de stich");
show("multi-edit", r);
{
  const st = await getState(vendor.id, wa);
  const items = st.items || [];
  console.log("     carrito:", items.map((i) => `${i.name} x${i.qty}`).join(", "));
  condition("multi-edit: sacó Stich", !items.some((i) => i.name === "Stich"));
  condition("multi-edit: agregó 8 Cerezas", items.some((i) => i.name === "Cerezas 🍒" && Number(i.qty) === 8));
  condition("multi-edit: Maradona intacta", items.some((i) => i.name === "Maradona" && Number(i.qty) === 2));
  condition("multi-edit: BocaJuniors #2 en qty 3", items.some((i) => i.name === "Boca Juniors #2" && Number(i.qty) === 3));
}

// =====================================================================
// 4) "Boca quiero 3 y cerezas 8" — no borra el carrito
// =====================================================================
r = await send("Boca quiero 3 y cerezas 8");
show("mouthboca set", r);
{
  const st = await getState(vendor.id, wa);
  const items = st.items || [];
  condition("set-qty no borra el carrito", items.length >= 3);
  condition("set-qty: cerezas quedó en 8", items.some((i) => i.name === "Cerezas 🍒" && Number(i.qty) === 8));
}

// =====================================================================
// 5) Edición confirmada: "Sacame el Maradona" (remove por nombre)
// =====================================================================
r = await send("Sacame el Maradona");
show("saca maradona", r);
{
  const st = await getState(vendor.id, wa);
  condition("remove por nombre: Maradona afuera", !(st.items || []).some((i) => i.name === "Maradona"));
}

// =====================================================================
// 6) Multi-pick simple: "4 del 1 y del 17 3"
// =====================================================================
await clearState(vendor.id, wa);
r = await send("comercios");
await send("1");
r = await send("4 del 1 y del 17 3");
{
  const st = await getState(vendor.id, wa);
  const i1 = (st.items || []).find((i) => String(i.offerId).endsWith("-1"));
  const i17 = (st.items || []).find((i) => String(i.offerId).endsWith("-17"));
  condition("'4 del 1 y del 17 3' → 4×1 + 3×17", i1 && Number(i1.qty) === 4 && i17 && Number(i17.qty) === 3);
}

// =====================================================================
// 7) Multi-pick por índice desde la lista: "quiero el número 1 y el número 17"
// =====================================================================
await clearState(vendor.id, wa);
r = await send("comercios");
await send("1");
r = await send("quiero el número 1 y el número 17");
{
  const st = await getState(vendor.id, wa);
  condition("'quiero el número 1 y el número 17' → uno c/u",
    (st.items || []).some((i) => String(i.offerId).endsWith("-1") && Number(i.qty) === 1)
    && (st.items || []).some((i) => String(i.offerId).endsWith("-17") && Number(i.qty) === 1));
}

// =====================================================================
// 8) Back-stack: rubros → tienda → catálogo → volver → volver → volver → menú
// =====================================================================
await clearState(vendor.id, wa);
r = await send("hola");
r = await send("1");           // opción 1 → rubros
r = await send("1");           // comercio → tiendas
r = await send("1");           // Stickers DT (catálogo)
r = await send("volver");      // → lista de comercio
show("volver 1", r);
condition("volver 1 → lista de comercio", /elegí una tienda|Comercio/i.test(textsOf(r)));
r = await send("volver");      // → rubros
show("volver 2", r);
condition("volver 2 → rubros", /¿Qué te hace falta/i.test(textsOf(r)));
r = await send("volver");      // → menú principal
show("volver 3", r);
condition("volver 3 → menú principal (cadena completa)", /¿Qué querés hacer\?/i.test(textsOf(r)));

// =====================================================================
// 9) Mid-pedido con items: "volver" → catálogo (carrito intacto)
// =====================================================================
await clearState(vendor.id, wa);
r = await send("comercios");
await send("2");               // Azahar (2da opción de la lista)
r = await send("2 cafés");
r = await send("volver");
{
  const st = await getState(vendor.id, wa);
  const t = textsOf(r);
  condition("volver mid-pedido → catálogo del comercio", /Café con leche/i.test(t) && (st.items || []).length > 0);
}

// =====================================================================
// 10) Sticky bar presente en preguntas pendientes
// =====================================================================
await clearState(vendor.id, wa);
r = await send("comercios");
await send("1");
r = await send("1 Cerezas");
condition("sticky bar 'Paso' en preguntas pendientes", /Paso \d de/i.test(textsOf(r)));

// =====================================================================
// 11) "del 1 4" y "3 del 17" (variantes de posición de cantidad)
// =====================================================================
await clearState(vendor.id, wa);
r = await send("comercios");
await send("1");
r = await send("del 1 4");
{
  const st = await getState(vendor.id, wa);
  const i1 = (st.items || []).find((i) => String(i.offerId).endsWith("-1"));
  condition("'del 1 4' → 4×1", i1 && Number(i1.qty) === 4);
}
await clearState(vendor.id, wa);
r = await send("comercios");
await send("1");
r = await send("3 del 17");
{
  const st = await getState(vendor.id, wa);
  const i17 = (st.items || []).find((i) => String(i.offerId).endsWith("-17"));
  condition("'3 del 17' → 3×17", i17 && Number(i17.qty) === 3);
}

// =====================================================================
// 12) Frase desconocida NO borra el carrito (regresión: cart wipe)
// =====================================================================
await clearState(vendor.id, wa);
r = await send("comercios");
await send("1");
await send("4 del 1");
r = await send("como están?"); // NL no hace nada → no toca el carrito
{
  const st = await getState(vendor.id, wa);
  condition("mensaje mareado no borra el carrito", (st.items || []).length === 1 && Number(st.items[0].qty) === 4);
}

console.log(`\n=== GOLDEN: ${checks} checks, ${failures} fallas ===`);
process.exit(failures ? 1 : 0);
