// @ts-nocheck
// Regresión del transcript real: el bot entraba en loop al pedir horario de
// entrega, consultaba la turnera de estética y ofrecía horarios a un comercio
// cerrado que no los tiene. Acá se verifican los 4 escenarios.
process.env.BOT_TAKE_ORDERS = "1";
process.env.DATABASE_URL = "";

const { handleInbound } = await import("./src/bot.mjs");
const { clearState, getState, setState, DEFAULT_STATE } = await import("./src/state.mjs");

let SLOTS = [];
const calls = [];
const PRODUCTS = [{ id: "p1", name: "Milanesa Monstruo", price: 37000, category: "Especialidad", modifiers: [], variants: [] }];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  calls.push(u);
  if (u.includes("/api/delivery-availability")) {
    return { ok: true, json: async () => ({ ok: true, slots: SLOTS, deliveryCoordinar: false, deliveryPaused: false }) };
  }
  if (u.includes("/api/wa/menu")) {
    return { ok: true, json: async () => ({ vendor: { id: "store-1", store_name: "Leo y Mari", products: PRODUCTS }, products: PRODUCTS }) };
  }
  return { ok: true, json: async () => ({}) };
};

const VENDOR = {
  id: "store-1", store_name: "Leo y Mari", slug: "leo-y-mari", vertical: "gastronomia",
  enabled: true, delivery_options: "ambos", prep_time_min: 30,
  store_open: true, accept_orders_when_closed: false,
  transfer_alias: "alias", transfer_cbu: "cbu",
};
const WA = "5491100001111";
const WINDOWS = [
  { id: "2026-11-25|12:30-13:00", label: "hoy 12:30–13:00", range: "12:30–13:00" },
  { id: "2026-11-25|13:00-13:30", label: "hoy 13:00–13:30", range: "13:00–13:30" },
];

let fails = 0;
const ok = (label, cond) => {
  console.log(`${cond ? ">>> OK" : "!!! FALLA"}: ${label}`);
  if (!cond) fails++;
};

async function seed(patch = {}) {
  await clearState(VENDOR.id, WA);
  await setState(VENDOR.id, WA, {
    ...DEFAULT_STATE,
    items: [{ offerId: "p1", name: "Milanesa Monstruo", qty: 1, price: 37000 }],
    step: "flow", pendingFields: [], method: "delivery", customerAddress: "Santiago 670",
    customerName: "Juan", payment: "transferencia",
    currentVendorId: "store-1", currentVendorName: "Leo y Mari",
    currentVendorSlug: "leo-y-mari", currentVendorVertical: "gastronomia",
    currentVendorDelivery: "ambos", currentVendorOpen: true,
    currentVendorAcceptClosed: false, currentVendorPrepMin: 30,
    ...patch,
  });
}
async function send(body) {
  const r = await handleInbound({ vendor: VENDOR, waId: WA, body });
  return { text: (r.replies || []).join("\n"), state: await getState(VENDOR.id, WA) };
}

// 1) Sin franjas (gastronomía sin horarios): NO preguntar horario, mostrar ETA.
SLOTS = [];
await seed();
let r = await send("13:00");
ok("sin franjas: no vuelve a pedir horario", !/horario de entrega preferís/i.test(r.text));
ok("sin franjas: muestra ETA desde que se toma el pedido", /~30 min desde que confirmamos/.test(r.text));
ok("sin franjas: deliveryWindow queda null", r.state.deliveryWindow == null);

// 2) Cerrado sin toggle: cortar el flujo (espejo de order-service).
await seed({ currentVendorOpen: false });
r = await send("a domicilio, Santiago 670, transferencia");
ok("cerrado sin toggle: avisa que no recibe pedidos", /cerrado ahora y no recibe pedidos/.test(r.text));
ok("cerrado sin toggle: no pregunta horario", !/horario de entrega/i.test(r.text));
ok("cerrado sin toggle: vuelve a idle", r.state.step === "idle");

// 3) Cerrado CON toggle "recibir pedido estando cerrado": sigue el flujo.
await seed({ currentVendorOpen: false, currentVendorAcceptClosed: true });
r = await send("13:00");
ok("cerrado con toggle: no corta", !/no recibe pedidos/.test(r.text));
ok("cerrado con toggle: muestra ETA", /~30 min/.test(r.text));

// 4) Con franjas: la lista se muestra UNA vez y "2" elige la segunda.
SLOTS = WINDOWS;
await seed();
r = await send("hola");
ok("con franjas: muestra la lista con labels", /hoy 12:30–13:00/.test(r.text) && /hoy 13:00–13:30/.test(r.text));
r = await send("2");
ok("con franjas: '2' no vuelve a mostrar la lista", !/horario de entrega preferís/i.test(r.text));
ok("con franjas: confirma el horario elegido", /13:00–13:30/.test(r.text));
ok("con franjas: guarda el window id válido", r.state.deliveryWindow === WINDOWS[1].id);
ok("con franjas: pending resuelto", r.state.deliverySelectionPending === false);

// 5) "lo antes posible" y respuesta inválida.
await seed();
await send("hola");
r = await send("lo antes posible");
ok("'lo antes posible' elige el primer slot", r.state.deliveryWindow === WINDOWS[0].id);

await seed();
await send("hola");
r = await send("99");
ok("inválido: sigue pendiente", r.state.deliverySelectionPending === true && r.state.deliveryWindow == null);
ok("inválido: da una salida clara", /No encontré ese horario/.test(r.text));

ok("nunca consulta la turnera de estética", !calls.some((u) => u.includes("slot-availability")));
ok("consulta delivery-availability con el comercio elegido", calls.some((u) => u.includes("delivery-availability?vendorId=store-1")));

console.log(`\n=== DELIVERY FLOW: ${fails === 0 ? "TODO OK" : `${fails} FALLAS`} ===`);
process.exit(fails ? 1 : 0);
