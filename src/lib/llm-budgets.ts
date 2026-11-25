import { query, queryOne } from "@/lib/db";

export type LlmProvider = "gemini" | "groq" | "openrouter";
export const LLM_PROVIDERS: LlmProvider[] = ["gemini", "groq", "openrouter"];

export const MIGRATION_HINT =
  "Falta aplicar supabase/self-host/migrate-llm-usage.sql en el contenedor de DB";

function budgetKey(provider: LlmProvider) {
  return `llm_budget_${provider}`;
}

/** Presupuesto mensual declarado en USD. null = sin tope declarado. */
export async function getLlmBudget(provider: LlmProvider): Promise<number | null> {
  try {
    const r = await queryOne<{ value: unknown }>(
      `SELECT value FROM portal_settings WHERE key = $1`, [budgetKey(provider)]
    );
    if (!r) return null;
    const value = typeof r.value === "string" ? JSON.parse(r.value) : r.value;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

export async function getLlmBudgets(): Promise<Record<LlmProvider, number | null>> {
  const out: Record<LlmProvider, number | null> = { gemini: null, groq: null, openrouter: null };
  for (const p of LLM_PROVIDERS) out[p] = await getLlmBudget(p);
  return out;
}

export async function setLlmBudget(provider: LlmProvider, value: number | null): Promise<void> {
  if (!LLM_PROVIDERS.includes(provider)) throw new Error("Proveedor inválido");
  if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1_000_000)) {
    throw new Error("Monto inválido (0 a 1.000.000 USD)");
  }
  await query(
    `INSERT INTO portal_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
    [budgetKey(provider), JSON.stringify(value)]
  );
}
