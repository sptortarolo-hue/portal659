// @ts-nocheck
// Test de aceptación: LOS CINCO MENSAJES que un cliente manda de verdad deben
// terminar en un pedido confirmado. Si esto falla, el bot no sirve — aunque
// responda bonito. Sin LLM real: se fuerza el parser determinista.
process.env.BOT_TAKE_ORDERS = "1";
process.env.DATABASE_URL = "";
process.env.WA_QUOTE_MODE = "off";

const { handleInbound } = await import("./src/bot.mjs");
const { clearState, getState } = await import("./src/state.mjs");

const PRODUCTS = [
  { id: "mila", name: "Milanesa Monstruo", price: 37000, category: "Especialidad", modifiers: [], variants: [] },
  { id: "coca", name: "Coca-Cola 500ml", price: 1000, category: "Bebidas", modifiers: [], variants: [] },
];
const VENDOR = {
  id: "store-1", store_name: "Leo y Mari", slug: "leo-y-mari", vertical: "gastronomia",
  enabled: true, delivery_options: "retiro", store_open: true,
  transfer_alias: "alias", transfer_cbu: "cbu",
};
const WA = "5491100002222";
const calls = [];

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  calls.push(u);
  if (u.includes("/api/wa/menu") || u.includes("/api/wa/portal-menu")) {
    return { ok: true, json: async () => ({ vendor: VENDOR, products: PRODUCTS, vendors: [{ ...VENDOR, products: PRODUCTS }] }) };
  }
  if (u.includes("/api/wa/order")) {
    return { ok: true, json: async () => ({ ok: true, orderId: "ord-1", pickupNumber: 7, total: 75000, trackToken: "tok-1" }) };
  }
  if (u.includes("/api/wa/quote")) return { ok: true, json: async () => ({ ok: true, total: 75000 }) };
  if (u.includes("/api/wa/customer")) return { ok: true, json: async () => ({}) };
  if (u.includes("/api/payments")) return { ok: true, json: async () => ({ configured: false }) };
  return { ok: true, json: async () => ({}) };
};

let fails = 0;
const ok = (label, cond) => {
  console.log(`${cond ? ">>> OK" : "!!! FALLA"}: ${label}`);
  if (!cond) fails++;
};

await clearState(VENDOR.id, WA);
const steps = [
  "hola",
  "quiero 2 milanesas monstruo y una coca",
  "retiro",
  "Juan",
  "efectivo",
  "sí",
];
const log = [];
let stateBeforeConfirm = null;
for (const body of steps) {
  const r = await handleInbound({ vendor: VENDOR, waId: WA, body });
  const text = (r.replies || []).join("\n");
  log.push(`CLIENTE: ${body}\nBOT: ${text}`);
  if (body === "efectivo") stateBeforeConfirm = await getState(VENDOR.id, WA);
}

const st = stateBeforeConfirm;
console.log("\n----- conversación -----\n" + log.join("\n\n") + "\n");
console.log("carrito:", (st.items || []).map((i) => `${i.name} ×${i.qty}`).join(", ") || "(vacío)");

ok("carrito: 2 milanesas y 1 coca", (st.items || []).some((i) => i.offerId === "mila" && Number(i.qty) === 2)
  && (st.items || []).some((i) => i.offerId === "coca" && Number(i.qty) === 1));
ok("nombre del cliente es Juan", st.customerName === "Juan");
ok("método retiro", st.method === "pickup");
ok("pedido creado en el servidor", calls.some((u) => u.includes("/api/wa/order")));
ok("confirmación visible", /Pedido confirmado/i.test(log.at(-1)));
ok("estado en confirmación con pago", st.payment === "efectivo");
ok("link de seguimiento único", (log.at(-1).match(/Seguí tu pedido/g) || []).length === 1);
ok("nunca se llamó a la turnera", !calls.some((u) => u.includes("slot-availability")));

console.log(`\n=== ORDER ACCEPTANCE: ${fails === 0 ? "TODO OK" : `${fails} FALLAS`} ===`);
process.exit(fails ? 1 : 0);
