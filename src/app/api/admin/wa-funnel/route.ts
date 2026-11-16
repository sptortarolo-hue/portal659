import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-utils";
import { queryOne, queryMany } from "@/lib/db";

/** Embudo de conversión del bot del portal (número central). Admin only.
 *  Cuenta eventos de wa_bot_events en la ventana (default 30 días): menú,
 *  rubros, tienda elegida, ítem, pedido, handoff. SIN PII (solo wa_id hasheado
 *  por DISTINCT al servidor, nunca exportado). */
export async function GET(request: Request) {
  if (!(await isAdmin(request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const url = new URL(request.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") || "30")));

  const portal = await queryOne<{ id: string }>(
    `SELECT id FROM vendors
     WHERE slug IN ('portal659-bot','portal-central','admin-portal659')
     ORDER BY created_at ASC LIMIT 1`
  ).catch(() => null);
  if (!portal) {
    return NextResponse.json({ portal: null, days, funnel: [], byDay: [] });
  }

  const rows = await queryMany<{ event_type: string; total: string; unique_phones: string }>(
    `SELECT event_type, COUNT(*)::text AS total, COUNT(DISTINCT wa_id)::text AS unique_phones
     FROM wa_bot_events
     WHERE vendor_id = $1 AND created_at > now() - ($2 || ' days')::interval
     GROUP BY event_type`,
    [portal.id, String(days)]
  ).catch(() => []);

  const raw: Record<string, number> = {};
  const uniq: Record<string, number> = {};
  for (const r of rows || []) {
    raw[r.event_type] = Number(r.total);
    uniq[r.event_type] = Number(r.unique_phones);
  }

  const STEPS = [
    { key: "funnel_menu_shown", label: "Menú mostrado" },
    { key: "funnel_rubro_menu", label: "Exploró rubros" },
    { key: "funnel_rubro_selected", label: "Eligió rubro" },
    { key: "funnel_store_selected", label: "Eligió tienda" },
    { key: "funnel_item_added", label: "Agregó ítem" },
    { key: "order_created", label: "Pedido creado" },
    { key: "open_stores", label: "Vio locales abiertos" },
    { key: "status_query", label: "Consultó estado" },
    { key: "funnel_handoff", label: "Handoff (menú)" },
    { key: "handoff", label: "Handoff (ayuda)" },
    { key: "nlu_not_understood", label: "No entendido" },
    { key: "cart_abandoned", label: "Carrito abandonado" },
    { key: "b2b_query", label: "Consulta B2B" },
  ];
  const funnel = STEPS.map((s) => ({ ...s, total: raw[s.key] || 0, unique: uniq[s.key] || 0 }));

  const byDay = await queryMany<{ day: string; count: string }>(
    `SELECT (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date::text AS day,
            COUNT(*)::text AS count
     FROM wa_bot_events
     WHERE vendor_id = $1 AND event_type = 'order_created'
       AND created_at > now() - ($2 || ' days')::interval
     GROUP BY day
     ORDER BY day ASC`,
    [portal.id, String(days)]
  ).catch(() => []);

  return NextResponse.json({
    portal: { id: portal.id },
    days,
    funnel,
    byDay: (byDay || []).map((d) => ({ day: d.day, count: Number(d.count) })),
  });
}
