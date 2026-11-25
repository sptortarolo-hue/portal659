import { query } from "@/lib/db";

/**
 * Contabilidad de IA del lado del app (extracción de facturas).
 * Espejo de services/wa-bot/src/llm-accounting.mjs: mismas columnas y reglas.
 * Fire-and-forget: un error de DB nunca debe romper la extracción.
 */

export type LlmUsageSource = "bot" | "facturas" | "playground" | "lab" | "test";

type Pricing = {
  note: string;
  updated: string;
  models: Record<string, { input: number; output: number }>;
};
// El catálogo de precios vive en un solo archivo, compartido con el motor.
import pricingJson from "../../services/wa-bot/src/llm-pricing.json";
const PRICING = pricingJson as Pricing;

export type LlmUsageRecord = {
  source: LlmUsageSource;
  agentKey?: string | null;
  vendorId?: string | null;
  provider: string;
  model: string;
  prompt?: number;
  completion?: number;
  total?: number;
  costUsd?: number | null;
  costSource?: "provider" | "estimate" | "none";
  success?: boolean;
  latencyMs?: number | null;
  meta?: Record<string, unknown>;
};

/** Convierte `usage` de Gemini/OpenAI-compatible a columnas de llm_usage. */
export function parseLlmUsage(data: any, provider: string, model: string) {
  const u = data?.usage || data?.usageMetadata || {};
  const prompt = Number(u.prompt_tokens ?? u.input_tokens ?? u.promptTokenCount ?? 0) || 0;
  const completion = Number(u.completion_tokens ?? u.output_tokens ?? u.candidatesTokenCount ?? 0) || 0;
  const total = Number(u.total_tokens ?? u.totalTokenCount ?? prompt + completion) || 0;
  const providerCost = Number(u.cost ?? u.costUSD ?? NaN);
  if (Number.isFinite(providerCost)) {
    return { prompt, completion, total, costUsd: providerCost, costSource: "provider" as const };
  }
  const p = PRICING.models[model];
  if (p) {
    const estimate = (prompt / 1_000_000) * Number(p.input || 0) + (completion / 1_000_000) * Number(p.output || 0);
    return { prompt, completion, total, costUsd: Number(estimate.toFixed(6)), costSource: "estimate" as const };
  }
  return { prompt, completion, total, costUsd: null, costSource: "none" as const };
}

export function recordLlmUsage(rec: LlmUsageRecord) {
  try {
    const usage = rec.costUsd !== undefined && rec.costSource
      ? {
          prompt: rec.prompt || 0, completion: rec.completion || 0, total: rec.total || 0,
          costUsd: rec.costUsd, costSource: rec.costSource,
        }
      : parseLlmUsage(rec, rec.provider, rec.model);
    void query(
      `INSERT INTO public.llm_usage
        (occurred_at, source, agent_key, vendor_id, provider, model,
         prompt_tokens, completion_tokens, total_tokens, calls, cost_usd, cost_source,
         success, latency_ms, meta)
       VALUES (now(), $1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $11, $12, $13::jsonb)`,
      [
        rec.source, rec.agentKey || null, rec.vendorId || null, rec.provider, rec.model,
        usage.prompt || 0, usage.completion || 0, usage.total || 0,
        usage.costUsd ?? null, usage.costSource || "none",
        rec.success !== false, rec.latencyMs ?? null, JSON.stringify(rec.meta || {}),
      ]
    ).catch(() => {});
  } catch {
    // Nunca romper la operación que originó la llamada LLM.
  }
}
