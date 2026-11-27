// @ts-nocheck
// Regresión de los síntomas reportados desde WhatsApp: basura en el carrito,
// "sticker" como nombre del cliente, "agregá" que no suma y reemplazos que
// borran lo que ya estaba. Todo se prueba SIN LLM (contrato determinista).
const { sanitizeParsed, upsertItems, resolveOperation } = await import("./src/order-intent.mjs");

const PRODUCTS = [
  { id: "mila", name: "Milanesa Monstruo", price: 37000 },
  { id: "coca", name: "Coca-Cola 500ml", price: 1000 },
  { id: "emp", name: "Empanada de carne", price: 1200 },
  { id: "sticker", name: "Sticker Boca Juniors", price: 6000 },
];
const ctx = (text) => ({ text, products: PRODUCTS, cart: [], pending: [] });

let fails = 0;
const ok = (label, cond) => {
  console.log(`${cond ? ">>> OK" : "!!! FALLA"}: ${label}`);
  if (!cond) fails++;
};

// 1) Dos artículos en un mismo mensaje: NO se pierde el segundo.
let s = sanitizeParsed({
  op: "add",
  items: [
    { offerId: "mila", name: "Milanesa Monstruo", qty: 1 },
    { offerId: "coca", name: "Coca-Cola 500ml", qty: 2 },
  ],
}, ctx("quiero una milanesa y dos cocas"));
ok("multi-ítem: conserva los dos productos", s.items.length === 2);
ok("multi-ítem: cantidades correctas", s.items[1].qty === 2);

// 2) Producto inexistente → unknownItems, nunca entra al carrito.
s = sanitizeParsed({
  op: "add",
  items: [{ offerId: "x", name: "nafta", qty: 1 }, { offerId: "emp", name: "Empanada de carne", qty: 2 }],
}, ctx("una empanada y nafta"));
ok("producto inexistente: se reporta", s.unknownItems.includes("nafta"));
ok("producto inexistente: no contamina items", s.items.length === 1 && s.items[0].offerId === "emp");

// 3) "sticker" como nombre del cliente → se descarta.
s = sanitizeParsed({ items: [], customerName: "sticker" }, ctx("sticker"));
ok("producto como nombre: se descarta", s.customerName === null);
s = sanitizeParsed({ items: [], customerName: "Juan Pérez" }, ctx("Juan Pérez"));
ok("nombre real: se conserva", s.customerName === "Juan Pérez");

// 4) La operación la decide el mensaje, no el LLM.
ok("'agregá' => add aunque el LLM dijera setQty", resolveOperation("agregá otra coca", { op: "setQty" }) === "add");
ok("'solo' => setQty", resolveOperation("solo una coca", { op: "add" }) === "setQty");
ok("'sacá' => remove", resolveOperation("sacá la empanada", { op: "add" }) === "remove");

// 5) Agregar sobre carrito existente NUNCA reemplaza.
const cart = [{ offerId: "mila", name: "Milanesa Monstruo", qty: 1, price: 37000 }];
let next = upsertItems(cart, sanitizeParsed({
  items: [{ offerId: "coca", name: "Coca-Cola 500ml", qty: 1 }],
}, ctx("agregá una coca")).items);
ok("agregar: conserva la milanesa", next.some((i) => i.offerId === "mila"));
ok("agregar: suma la coca", next.some((i) => i.offerId === "coca"));
ok("agregar: carrito original intacto", cart.length === 1);

// 6) setQty actualiza cantidades sin borrar otros ítems.
next = upsertItems([
  { offerId: "mila", name: "Milanesa Monstruo", qty: 1 },
  { offerId: "coca", name: "Coca-Cola 500ml", qty: 1 },
  { offerId: "emp", name: "Empanada de carne", qty: 1 },
], [
  { offerId: "mila", name: "Milanesa Monstruo", qty: 3 },
  { offerId: "coca", name: "Coca-Cola 500ml", qty: 2 },
], "setQty");
ok("setQty: actualiza milanesa a 3", next.find((i) => i.offerId === "mila").qty === 3);
ok("setQty: actualiza coca a 2", next.find((i) => i.offerId === "coca").qty === 2);
ok("setQty: no borra la empanada", next.some((i) => i.offerId === "emp"));

// 7) Mismo producto dos veces en un mensaje se suma, no se duplica.
next = upsertItems([{ offerId: "coca", name: "Coca-Cola 500ml", qty: 1 }], [
  { offerId: "coca", name: "Coca-Cola 500ml", qty: 2 },
]);
ok("mismo producto: qty sumada sin duplicar", next.length === 1 && next[0].qty === 3);

console.log(`\n=== ORDER INTENT: ${fails === 0 ? "TODO OK" : `${fails} FALLAS`} ===`);
process.exit(fails ? 1 : 0);
