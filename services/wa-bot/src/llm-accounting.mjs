// @ts-nocheck — pendiente de conversión a TypeScript.
// Contabilidad de IA del bot: convierte el `usage` de la respuesta en un row
// de llm_usage y lo escribe fire-and-forget. NUNCA puede romper una respuesta
// del bot: si la DB no está, se descarta silenciosamente.

import { config } from "./config.mjs";
import { query } from "./db.mjs";
import pricing from "./llm-pricing.json" with { type: "json" };

const MODELS = pricing.models || {};

/** Normaliza el usage de OpenAI-compatible / Gemini al esquema de llm_usage. */
export function extractUsage(data, provider, model, meta = {}) {
  const u = data?.usage || data?.usageMetadata || {};
  const prompt = Number(u.prompt_tokens ?? u.input_tokens ?? u.promptTokenCount ?? 0) || 0;
  const completion = Number(u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount ?? 0) || 0;
  const total = Number(u.total_tokens ?? u.totalTokenCount ?? prompt + completion) || 0;

  // OpenRouter reporta el costo REAL de la llamada en usage.cost.
  const providerCost = Number(u.cost ?? u.costUSD ?? NaN);
  if (Number.isFinite(providerCost)) {
    return { prompt, completion, total, cost_usd: providerCost, cost_source: "provider", meta };
  }

  const p = MODELS[model];
  if (p) {
    const estimate = (prompt / 1_000_000) * Number(p.input || 0) + (completion / 1_000_000) * Number(p.output || 0);
    return { prompt, completion, total, cost_usd: Number(estimate.toFixed(6)), cost_source: "estimate", meta };
  }
  return { prompt, completion, total, cost_usd: null, cost_source: "none", meta };
}

const INSERT = `INSERT INTO public.llm_usage
  (occurred_at, source, agent_key, vendor_id, provider, model,
   prompt_tokens, completion_tokens, total_tokens, calls, cost_usd, cost_source,
   success, latency_ms, meta)
  VALUES (now(), $1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $11, $12, $13::jsonb)`;

/**
 * @param {object} rec { source, agentKey, vendorId, provider, model, usage, success, latencyMs }
 */
export function recordUsage(rec) {
  if (!config.databaseUrl) return; // tests/dev sin DB
  try {
    const u = rec.usage || {};
    const params = [
      rec.source || "bot",
      rec.agentKey || null,
      rec.vendorId || null,
      rec.provider || "desconocido",
      rec.model || "desconocido",
      Number(u.prompt_tokens ?? u.prompt ?? 0) || 0,
      Number(u.completion_tokens ?? u.completion ?? 0) || 0,
      Number(u.total_tokens ?? u.total ?? 0) || 0,
      u.cost_usd ?? null,
      u.cost_source || "none",
      rec.success !== false,
      Number(rec.latencyMs) || null,
      JSON.stringify(u.meta || {}),
    ];
    // Fire-and-forget: ni el await ni el error llegan al flujo del bot.
    Promise.resolve().then(() => query(INSERT, params)).catch(() => {});
  } catch {
    // Nunca interferir con la conversación.
  }
}
