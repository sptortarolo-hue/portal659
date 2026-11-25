// @ts-nocheck
process.env.DATABASE_URL = "";

const { extractUsage, recordUsage } = await import("./src/llm-accounting.mjs");

let fails = 0;
const ok = (label, cond) => {
  console.log(`${cond ? ">>> OK" : "!!! FALLA"}: ${label}`);
  if (!cond) fails++;
};

// OpenRouter: costo REAL informado por el proveedor.
const or = extractUsage({ usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, cost: 0.00042 } }, "openrouter", "google/gemma-4-31b-it:free");
ok("OpenRouter usa usage.cost (costo del proveedor)", or.cost_usd === 0.00042 && or.cost_source === "provider" && or.total === 1200);

// Gemini: estimación con tabla compartida.
const ge = extractUsage({ usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 } }, "gemini", "gemini-2.5-flash");
ok("Gemini estima con la tabla y lo marca estimate", ge.cost_source === "estimate" && ge.cost_usd === 2.8);

// Modelo sin precio: costo nulo, nunca inventado.
const none = extractUsage({ usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } }, "gemini", "modelo-nuevo-x");
ok("Modelo desconocido: costo null y source none", none.cost_usd === null && none.cost_source === "none" && none.total === 15);

// Fire-and-forget sin DB no lanza (test/dev).
let threw = false;
try { recordUsage({ source: "test", provider: "gemini", model: "x", usage: or, success: true }); } catch { threw = true; }
ok("sin DATABASE_URL recordUsage no lanza", !threw);

console.log(`\n=== CONTABILIDAD IA: ${fails === 0 ? "TODO OK" : `${fails} FALLAS`} ===`);
process.exit(fails ? 1 : 0);
