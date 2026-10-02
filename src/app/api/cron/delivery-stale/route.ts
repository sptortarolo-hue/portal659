import { query, queryMany, queryOne } from "@/lib/db";
import { sendPushToUser } from "@/lib/push";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Ventana de nudge: si el último fix tiene entre NUDGE_MIN y NUDGE_MAX
// minutos, se avisa UNA vez por episodio (al siguiente run ya está fuera de
// ventana → no spamea cada 5 min; si retoma y vuelve a cortarse, renudgea).
const NUDGE_MIN_MS = 3 * 60 * 1000;
const NUDGE_MAX_MS = 8 * 60 * 1000;

type StaleOrder = {
  id: string;
  assigned_to: string;
  pickup_number: number | null;
  store_name: string;
  courier_updated_at: string | null;
  sent_at: string | null;
};

/**
 * Nudge al repartidor sin señal (cron en el host cada 5 min):
 *   GET /api/cron/delivery-stale?secret=...
 * - Pedidos delivery en `sent` con repartidor asignado cuyo último fix tiene
 *   3-8 min (o nunca compartió y se despachó hace 3-8 min) → push
 *   "tocá para reactivar" que abre el board (el board retoma solo + fix
 *   inmediato al abrir).
 * - Tolerante a migración migrate-delivery-live.sql sin aplicar (skip).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const got = new URL(request.url).searchParams.get("secret") || "";
  if (!secret || got !== secret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const hasCol = await queryOne<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'courier_updated_at') AS exists`
  ).catch(() => null);
  if (!hasCol?.exists) {
    return NextResponse.json({ ok: true, skipped: "falta migración delivery-live" });
  }

  const rows = await queryMany<StaleOrder>(
    `SELECT o.id, o.assigned_to, o.pickup_number, v.store_name,
       o.courier_updated_at::text AS courier_updated_at,
       (SELECT l.created_at::text FROM order_status_log l
         WHERE l.order_id = o.id AND l.status = 'sent'
         ORDER BY l.created_at DESC LIMIT 1) AS sent_at
     FROM orders o JOIN vendors v ON v.id = o.vendor_id
     WHERE o.method = 'delivery' AND o.status = 'sent'
       AND o.assigned_to IS NOT NULL
       AND o.created_at > NOW() - INTERVAL '6 hours'`
  ).catch(() => []);

  const now = Date.now();
  let nudged = 0;
  for (const o of rows || []) {
    const ref = o.courier_updated_at || o.sent_at;
    if (!ref) continue;
    const age = now - new Date(ref).getTime();
    if (age < NUDGE_MIN_MS || age > NUDGE_MAX_MS) continue;
    const num = o.pickup_number != null ? ` Nro. ${o.pickup_number}` : "";
    const title = "📡 Reactivá tu ubicación";
    const body = `${o.store_name}: tu pedido${num} va sin señal hace unos minutos. Tocá para reactivarla.`;
    try {
      await query(
        `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, 'delivery', '/vendor/dashboard')`,
        [o.assigned_to, title, body]
      );
      try {
        await sendPushToUser(o.assigned_to, { title, body, link: "/vendor/dashboard" });
      } catch { /* best-effort */ }
      nudged++;
    } catch { /* sigue con el próximo */ }
  }

  return NextResponse.json({ ok: true, nudged });
}
