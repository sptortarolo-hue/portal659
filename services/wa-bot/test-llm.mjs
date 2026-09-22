// Test del lado IA: contexto de conversación en el prompt, re-declarar/agregar
// con LLM, y el fix del bypass de cooldown (429 no se reintenta con timeout 60s).
process.env.LLM_API_KEY = "test-key";
process.env.LLM_BASE_URL = "https://openrouter.ai/api/v1";
process.env.LLM_MODEL = "google/gemma-4-31b-it:free";

const { handleInbound } = await import("./src/bot.mjs");
const { parseWithLlm } = await import("./src/nlu.mjs");

const MOCK_MENU = {
  products: [
    { id: "p1", name: "Empanada de carne", price: 1200, category: "Empanadas" },
    { id: "p3", name: "Coca-Cola 500ml", price: 1000, category: "Bebidas" },
  ],
};

let llmCalls = 0;
let lastPrompt = null;
let llmReply = null;
let fail429 = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("/api/wa/menu")) return { ok: true, json: async () => MOCK_MENU };
  if (u.includes("/api/wa/order")) return { ok: true, json: async () => ({ ok: true, orderId: "ord-1", total: 1000 }) };
  if (u.includes("/api/wa/handoff")) return { ok: true, json: async () => ({ ok: true }) };
  if (u.includes("/chat/completions")) {
    llmCalls++;
    lastPrompt = JSON.parse(opts?.body || "{}");
    if (fail429) return { ok: false, status: 429, text: async () => "{}", json: async () => ({}) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(llmReply) } }] }) };
  }
  return realFetch(url, opts);
};

const vendor = { id: "vtest", store_name: "Che Sancho", slug: "che-sancho", enabled: true, transfer_alias: "ch.mp", transfer_cbu: null };
const wa = "5491100000001";

function show(label, r) {
  console.log(`\n===== ${label} =====`);
  console.log((r.replies || []).join("\n---\n"));
}

async function main() {
  let ok = true;

  // ESC A: pedido inicial (LLM) + preguntas → contexto en el prompt.
  llmReply = { complete: true, items: [{ name: "Empanada de carne", qty: 2 }] };
  let r = await handleInbound({ vendor, waId: wa, body: "quiero 2 empanadas de carne" });
  show("pedido inicial (LLM)", r);
  llmReply = { complete: false, items: [], method: "delivery" };
  r = await handleInbound({ vendor, waId: wa, body: "envío a calle 5 123" });
  show("envío (LLM)", r);

  // Re-declaración: el LLM (con contexto) devuelve el carrito COMPLETO actualizado.
  llmReply = { complete: true, items: [{ name: "Empanada de carne", qty: 3 }, { name: "Coca-Cola 500ml", qty: 1 }] };
  r = await handleInbound({ vendor, waId: wa, body: "quiero 3 empanadas y una coca" });
  show("re-declaración (LLM carrito completo)", r);
  const redec = (r.replies || []).join(" ");
  if (!redec.includes("×3") || redec.includes("×6") || redec.includes("×5")) {
    console.log("!!! re-declaración duplicó o no actualizó"); ok = false;
  }

  const content = lastPrompt?.messages?.[1]?.content || "";
  if (!content.includes("Carrito actual") || !content.includes("Le acabás de preguntar") || !content.includes("CLIENTE:")) {
    console.log("!!! El prompt del LLM no lleva el contexto (carrito/pendientes/historial)");
    console.log("--- prompt:", content.slice(0, 400));
    ok = false;
  } else {
    console.log(">>> OK: prompt con contexto (carrito + pendientes + historial)");
  }

  // ESC B: agregar con LLM que devuelve SOLO los items nuevos → merge.
  llmReply = { complete: true, items: [{ name: "Coca-Cola 500ml", qty: 1 }] };
  r = await handleInbound({ vendor, waId: wa, body: "agregá otra coca" });
  show("agregar (LLM solo nuevos)", r);
  if (!(r.replies || []).join(" ").includes("×2")) { console.log("!!! el agregado no sumó (debería ×2)"); ok = false; }

  // ESC C: cooldown — agotar alternativas con 429 y verificar que el próximo
  // mensaje NO reintenta (antes colgaba hasta 60s por mensaje).
  fail429 = true;
  llmCalls = 0;
  let r1 = await parseWithLlm("test", MOCK_MENU.products, { cart: [], pending: [], history: [] });
  const firstRoundCalls = llmCalls;
  llmCalls = 0;
  const t0 = Date.now();
  let r2 = await parseWithLlm("test", MOCK_MENU.products, { cart: [], pending: [], history: [] });
  const dt = Date.now() - t0;
  const secondRoundCalls = llmCalls;
  fail429 = false;
  console.log(`\n===== cooldown: 1º mensaje ${firstRoundCalls} llamadas (1+alternativas), 2º mensaje ${secondRoundCalls} llamadas en ${dt}ms =====`);
  if (r1 !== null) { console.log("!!! con 429 el parse no debió resolver"); ok = false; }
  if (r2 !== null || secondRoundCalls !== 0) {
    console.log("!!! el 2º mensaje REINTENTÓ el modelo enfriado (bypass de cooldown)"); ok = false;
  } else {
    console.log(">>> OK: cooldown respetado — 2º mensaje sin llamadas, cae a reglas al instante");
  }

  if (!ok) { console.error("\n=== HAY FALLOS ==="); process.exit(1); }
  console.log("\n=== TODO OK ===");
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });