import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { MIGRATION_HINT } from "@/lib/llm-budgets";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/llm-cleanup?secret=... — retención de 90 días de llm_usage.
 * Cron semanal (lo instala el deploy automáticamente):
 *   10 4 * * 0 root curl -fsS "https://www.portal659.com.ar/api/cron/llm-cleanup?secret=$CRON_SECRET" >> /var/log/portal659-cron.log 2>&1
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
    const before = await queryOne<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.llm_usage WHERE occurred_at < now() - interval '90 days'`
    );
    await query(`DELETE FROM public.llm_usage WHERE occurred_at < now() - interval '90 days'`);
    return NextResponse.json({ ok: true, deleted: before?.n || 0 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "falló" }, { status: 503 });
  }
}
