import { handleInbound } from "./src/bot.mjs";

const MOCK_MENU = {
  products: [
    { id: "p1", name: "Empanada de carne", price: 1200, category: "Empanadas" },
    { id: "p2", name: "Empanada de jamón y queso", price: 1300, category: "Empanadas" },
    { id: "p3", name: "Coca-Cola 500ml", price: 1000, category: "Bebidas" },
    { id: "p4", name: "Pizza muzzarella", price: 8000, category: "Pizzas" },
  ],
};
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("/api/wa/menu")) return { ok: true, json: async () => MOCK_MENU };
  if (u.includes("/api/wa/order")) return { ok: true, json: async () => ({ ok: true, orderId: "ord-123", total: 4400 }) };
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
  console.log(JSON.stringify(r.replies || [], null, 2));
}

async function main() {
  let r;
  r = await handleInbound({ vendor, waId: wa, body: "hola" });
  show("hola", r);
  r = await handleInbound({ vendor, waId: wa, body: "quiero 2 empanadas de carne y una coca, envío a calle 5 123" });
  show("pedido + envío", r);
  r = await handleInbound({ vendor, waId: wa, body: "Juan Pérez, transferencia" });
  show("nombre + pago", r);
  r = await handleInbound({ vendor, waId: wa, body: "si" });
  show("confirmar", r);

  console.log("\n--- ESC 4: re-declarar NO duplica ---");
  r = await handleInbound({ vendor, waId: wa, body: "quiero 2 empanadas de carne y una coca" });
  show("pedido completo", r);
  r = await handleInbound({ vendor, waId: wa, body: "no, mejor solo 3 empanadas de carne" });
  show("re-declaración", r);

  console.log("\n--- ESC 5: cantidades en palabras ---");
  r = await handleInbound({ vendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor, waId: wa, body: "quiero una docena de empanadas de carne" });
  show("una docena", r);
  r = await handleInbound({ vendor, waId: wa, body: "cancelar" });
  r = await handleInbound({ vendor, waId: wa, body: "dos pizzas y tres coca" });
  show("dos pizzas + tres coca", r);
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
