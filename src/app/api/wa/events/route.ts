import { NextResponse } from "next/server";
import { authWaBot } from "@/lib/wa-bot";
import { query, queryMany } from "@/lib/db";

/**
 * POST /api/wa/events — el cerebro del bot registra eventos (mensaje entrante,
 * respuesta, handoff, pedido creado, carrito abandonado, etc.) para métricas
 * históricas. Best-effort: no bloquea el flujo del bot.
 *
 * Body: { vendorId, events: [{ type, waId?, meta?, ts? }] }
 * o: { vendorId, type, waId?, meta?, ts? } (evento único)
 */
export async function POST(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  let body: any;
  try { body = await request.json(); } catch { body = null; }
  if (!body) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });

  const vendorId = body.vendorId;
  if (!vendorId) return NextResponse.json({ error: "vendorId requerido" }, { status: 400 });

  // Normalizar: aceptar evento único o array.
  const events = Array.isArray(body.events) ? body.events : [body];
  if (events.length === 0) return NextResponse.json({ ok: true, inserted: 0 });

  // Insertar en batch (máx 50 por llamada para no saturar).
  const batch = events.slice(0, 50);
  let inserted = 0;
  for (const ev of batch) {
    const type = String(ev?.type || "").trim();
    if (!type) continue;
    const waId = ev?.waId ? String(ev.waId).replace(/@.*/, "") : null;
    const meta = ev?.meta && typeof ev.meta === "object" ? ev.meta : {};
    const ts = ev?.ts ? new Date(Number(ev.ts)) : new Date();
    try {
      await query(
        `INSERT INTO wa_bot_events (vendor_id, event_type, wa_id, meta, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [vendorId, type, waId, JSON.stringify(meta), ts]
      );
      inserted++;
    } catch {
      // best-effort: tabla sin migrar o error de DB → no fallar
    }
  }

  return NextResponse.json({ ok: true, inserted });
}

/**
 * GET /api/wa/events?vendorId=&days=7 — métricas históricas por comercio.
 * Devuelve conteos por tipo de evento y por día.
 */
export async function GET(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(request.url);
  const vendorId = url.searchParams.get("vendorId") || "";
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") || "7")));
  if (!vendorId) return NextResponse.json({ error: "vendorId requerido" }, { status: 400 });

  // Conteos por tipo (totales del período).
  const byType = await queryMany<{ event_type: string; count: string }>(
    `SELECT event_type, COUNT(*)::text AS count
     FROM wa_bot_events
     WHERE vendor_id = $1 AND created_at > now() - ($2 || ' days')::interval
     GROUP BY event_type
     ORDER BY count DESC`,
    [vendorId, String(days)]
  ).catch(() => []);

  // Conteos por día (para gráfico de barras).
  const byDay = await queryMany<{ day: string; event_type: string; count: string }>(
    `SELECT (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date::text AS day,
            event_type, COUNT(*)::text AS count
     FROM wa_bot_events
     WHERE vendor_id = $1 AND created_at > now() - ($2 || ' days')::interval
     GROUP BY day, event_type
     ORDER BY day ASC`,
    [vendorId, String(days)]
  ).catch(() => []);

  // Totales globales.
  const totals = await queryMany<{ total: string; unique_phones: string }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(DISTINCT wa_id)::text AS unique_phones
     FROM wa_bot_events
     WHERE vendor_id = $1 AND created_at > now() - ($2 || ' days')::interval`,
    [vendorId, String(days)]
  ).catch(() => []);

  return NextResponse.json({
    days,
    byType: (byType || []).map((r) => ({ type: r.event_type, count: Number(r.count) })),
    byDay: byDay || [],
    totals: totals?.[0] ? { total: Number(totals[0].total), uniquePhones: Number(totals[0].unique_phones) } : { total: 0, uniquePhones: 0 },
  });
}
