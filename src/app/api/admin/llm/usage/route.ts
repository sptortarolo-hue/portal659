import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryMany, queryOne } from "@/lib/db";
import { getLlmBudgets, MIGRATION_HINT } from "@/lib/llm-budgets";

export const dynamic = "force-dynamic";

async function openrouterQuota() {
  const key = process.env.OPENROUTER_API_KEY || "";
  if (!key) return { available: false, reason: "Sin OPENROUTER_API_KEY" };
  try {
    const r = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!r.ok) return { available: false, reason: `HTTP ${r.status}` };
    const d = await r.json();
    const k = d?.data || {};
    return {
      available: true,
      limit: k.limit ?? null,
      remaining: k.limit_remaining ?? null,
      usageMonthly: k.usage_monthly ?? null,
      usageDaily: k.usage_daily ?? null,
      resetsAt: k.effective_budget?.resets_at ?? null,
      resetInterval: k.limit_reset ?? null,
    };
  } catch (e: any) {
    return { available: false, reason: e?.message || "timeout" };
  }
}

export async function GET(request: Request) {
  if (!(await isAdmin(request))) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  try {
    const ready = await queryOne<{ ok: boolean }>(
      `SELECT to_regclass('public.llm_usage') IS NOT NULL AS ok`
    );
    if (!ready?.ok) return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });

    const daysRaw = Number(new URL(request.url).searchParams.get("days") || 30);
    const days = Math.min(366, Math.max(1, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : 30));

    const rows = await queryMany<any>(
      `SELECT source, provider, model, COALESCE(agent_key, '—') AS agent_key,
              SUM(total_tokens)::bigint::text AS tokens,
              SUM(prompt_tokens)::bigint::text AS prompt,
              SUM(completion_tokens)::bigint::text AS completion,
              SUM(calls)::bigint::text AS calls,
              COALESCE(SUM(cost_usd), 0)::float8 AS cost,
              SUM(CASE WHEN success THEN 0 ELSE 1 END)::bigint::text AS failures
       FROM public.llm_usage
       WHERE occurred_at >= now() - make_interval(days => $1::int)
       GROUP BY 1, 2, 3, 4
       ORDER BY tokens DESC LIMIT 300`,
      [days]
    );

    const daily = await queryMany<any>(
      `SELECT (occurred_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date::text AS day,
              SUM(total_tokens)::bigint::text AS tokens,
              COALESCE(SUM(cost_usd), 0)::float8 AS cost,
              SUM(calls)::bigint::text AS calls
       FROM public.llm_usage
       WHERE occurred_at >= now() - make_interval(days => $1::int)
       GROUP BY 1 ORDER BY 1`,
      [days]
    );

    const month = await queryMany<any>(
      `SELECT provider, SUM(total_tokens)::bigint::text AS tokens,
              COALESCE(SUM(cost_usd), 0)::float8 AS cost,
              SUM(calls)::bigint::text AS calls
       FROM public.llm_usage
       WHERE date_trunc('month', occurred_at AT TIME ZONE 'America/Argentina/Buenos_Aires')
           = date_trunc('month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
       GROUP BY 1 ORDER BY 1`
    );

    const groq = await queryOne<{ meta: any }>(
      `SELECT meta FROM public.llm_usage
       WHERE provider = 'groq' AND meta ? 'remainingTokens'
       ORDER BY occurred_at DESC LIMIT 1`
    ).catch(() => undefined);

    const budgets = await getLlmBudgets();
    const [orQuota] = await Promise.all([openrouterQuota()]);

    return NextResponse.json({
      days, rows, daily, monthByProvider: month, budgets,
      quotas: {
        openrouter: orQuota,
        groq: {
          available: true,
          source: "headers de la última respuesta (ventana de minutos, no cuota mensual)",
          remainingRequests: groq?.meta?.remainingRequests ?? null,
          remainingTokens: groq?.meta?.remainingTokens ?? null,
        },
        gemini: {
          available: false,
          reason: "Gemini no expone cuota por API key: consultala en AI Studio",
        },
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "No se pudo consultar el uso de IA" }, { status: 503 });
  }
}
