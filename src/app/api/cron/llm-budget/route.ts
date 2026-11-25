import { NextResponse } from "next/server";
import { queryMany, queryOne } from "@/lib/db";
import { getLlmBudgets, MIGRATION_HINT } from "@/lib/llm-budgets";
import { sendPushToUser } from "@/lib/push";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/llm-budget?secret=... — aviso al 80% del presupuesto mensual.
 * Cron en el host (lo instala el deploy automáticamente):
 *   0 10 * * * root curl -fsS "https://www.portal659.com.ar/api/cron/llm-budget?secret=$CRON_SECRET" >> /var/log/portal659-cron.log 2>&1
 * Idempotente: una alerta por proveedor/período/umbral en llm_budget_alert_log.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const got = new URL(request.url).searchParams.get("secret") || "";
  if (!secret || got !== secret) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  try {
    const ready = await queryOne<{ ok: boolean }>(
      `SELECT to_regclass('public.llm_usage') IS NOT NULL AS ok`
    );
    if (!ready?.ok) return NextResponse.json({ skipped: true, reason: MIGRATION_HINT });

    const budgets = await getLlmBudgets();
    const month = await queryMany<{ provider: string; cost: number; tokens: string }>(
      `SELECT provider, COALESCE(SUM(cost_usd), 0)::float8 AS cost,
              SUM(total_tokens)::bigint::text AS tokens
       FROM public.llm_usage
       WHERE date_trunc('month', occurred_at AT TIME ZONE 'America/Argentina/Buenos_Aires')
           = date_trunc('month', now() AT TIME ZONE 'America/Argentina/Buenos_Aires')
       GROUP BY 1`
    );
    const costBy = new Map(month.map((r) => [r.provider, Number(r.cost) || 0]));
    const period = await queryOne<{ p: string }>(
      `SELECT to_char(now() AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM') AS p`
    );
    const admins = await queryMany<{ id: string }>(
      `SELECT id FROM public.profiles WHERE is_admin = true LIMIT 20`
    ).catch(() => [] as { id: string }[]);

    const alerts: string[] = [];
    for (const provider of Object.keys(budgets) as Array<keyof typeof budgets>) {
      const budget = budgets[provider];
      if (!budget || budget <= 0) continue;
      const spent = costBy.get(provider) || 0;
      if (spent < budget * 0.8) continue;
      const inserted = await queryOne<{ provider: string }>(
        `INSERT INTO public.llm_budget_alert_log (provider, period, threshold)
         VALUES ($1, $2, 80) ON CONFLICT DO NOTHING RETURNING provider`,
        [provider, period?.p || "?"]
      );
      if (!inserted) continue; // ya avisamos este mes
      alerts.push(`${provider}: $${spent.toFixed(2)} de $${budget}`);
      for (const a of admins) {
        await sendPushToUser(a.id, {
          title: `⚠️ Presupuesto de IA al 80% (${provider})`,
          body: `Gasto del mes: $${spent.toFixed(2)} de $${budget}. Revisá /admin/ia.`,
          link: "/admin/ia",
          tag: `llm-budget-${provider}-${period?.p || ""}`,
        }).catch(() => {});
      }
    }
    return NextResponse.json({ ok: true, alerts, admins: admins.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "falló" }, { status: 503 });
  }
}
