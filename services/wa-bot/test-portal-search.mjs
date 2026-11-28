// @ts-nocheck
// Regresión del playground: "Hola me gusta comprar una milanesa" mostraba
// "Productos de la categoría indumentaria" con TODO el catálogo, porque el
// token "me" hacía match por substring con "indumentaria"/"MEGA".
process.env.BOT_TAKE_ORDERS = "1";
process.env.DATABASE_URL = "";

const { handleInbound } = await import("./src/bot.mjs");
const { clearState } = await import("./src/state.mjs");

const V = (id, store_name, products, vertical = "comercio") => ({ id, store_name, slug: id, vertical, store_open: true, products });
const MENU = { vendors: [
  V("azahar", "Azahar Café ConSentido", [
    { id: "cafe", name: "Café con leche", price: 2500, category: "Bebidas" },
  ]),
  V("burger", "Burger World", [
    { id: "mega", name: "MEGA CHEES", price: 16000, category: "Hamburguesas" },
  ]),
  V("leo", "Leo y Mari", [
    { id: "mila", name: "Milanesa Monstruo", price: 37000, category: "Especialidad" },
    { id: "media", name: "Media Mila Monstruo", price: 24000, category: "Especialidad" },
    { id: "sandwich", name: "Sándwich Milanesa Sola", price: 10000, category: "Especialidad" },
  ]),
  V("yema", "YEMA", [
    { id: "adobo", name: "Adobo para Pizza 100gr", price: 1100, category: "Condimentos" },
  ]),
  V("gráfica", "Soluciones Gráficas SD", [
    { id: "remera", name: "Remeras estampadas", price: 25000, category: "Indumentaria" },
  ], "moda"),
]};

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("/api/wa/portal-menu")) return { ok: true, json: async () => MENU };
  if (u.includes("/api/wa/menu")) {
    const id = u.match(/vendorId=([^&]+)/)?.[1] || "";
    const v = MENU.vendors.find((x) => x.id === decodeURIComponent(id)) || MENU.vendors[0];
    return { ok: true, json: async () => ({ vendor: v, products: v.products }) };
  }
  return { ok: true, json: async () => ({}) };
};

const PORTAL = { id: "portal-vendor", store_name: "Portal 659", slug: "portal659-bot", enabled: true, is_portal: true };
const WA = "5491100003333";

let fails = 0;
const ok = (label, cond) => {
  console.log(`${cond ? ">>> OK" : "!!! FALLA"}: ${label}`);
  if (!cond) fails++;
};
async function turn(body) {
  await clearState(PORTAL.id, WA);
  const r = await handleInbound({ vendor: PORTAL, waId: WA, body });
  return (r.replies || []).join("\n");
}

let t = await turn("Hola me gusta comprar una milanesa");
console.log("----- respuesta -----\n" + t + "\n");
ok("no dice categoría indumentaria", !/categoría \*indumentaria\*/i.test(t));
ok("dice 'Encontré en estos comercios'", /Encontré en estos comercios/i.test(t));
ok("encontró Leo y Mari", /Leo y Mari/.test(t));
ok("no arrastra Burger World por MEGA", !/Burger World/.test(t));
ok("no arrastra Soluciones Gráficas", !/Soluciones Gráficas/.test(t));
ok("no arrastra Azahar", !/Azahar/.test(t));

t = await turn("indumentaria");
console.log("----- categoría -----\n" + t + "\n");
ok("búsqueda explícita por categoría encuentra la tienda de moda", /Soluciones Gráficas/.test(t) && !/Milanesa Monstruo/.test(t));

t = await turn("Sandwich de Milanesa sola y media milanesa monstruo");
console.log("----- frase del playground -----\n" + t + "\n");
ok("'y' no selecciona YEMA", !/YEMA/.test(t));
ok("no entra a un comercio cerrado por un match débil", !/está cerrado ahora/.test(t));
ok("sigue en la lista de comercios por producto", /Encontré en estos comercios/.test(t) && /Leo y Mari/.test(t));

console.log(`\n=== PORTAL SEARCH: ${fails === 0 ? "TODO OK" : `${fails} FALLAS`} ===`);
process.exit(fails ? 1 : 0);
