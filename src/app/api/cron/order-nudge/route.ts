import { query, queryMany, queryOne } from "@/lib/db";
import { sendPushToUser } from "@/lib/push";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Minutos desde el pedido para el primer re-aviso. */
const FIRST_NUDGE_MIN = 5;
/** Hasta cuántas horas de viejo se re-avisa (después se da por perdido). */
const MAX_AGE_HOURS = 3;
/** Espacio mínimo entre re-avisos del mismo pedido. */
const NUDGE_EVERY_MIN = 15;

type StaleOrder = {
  id: string;
  vendor_id: string;
  customer_name: string;
  total: number | string;
  pickup_number: number | null;
  created_at: string;
  channel?: string | null;
  is_preview?: boolean | null;
  user_id?: string | null;
};

/**
 * Job de re-aviso de pedidos sin aceptar (cron en el host cada 5 min):
 *   GET /api/cron/order-nudge?secret=...
 * - Pedidos canal "app" (online) en estado "new" con 5+ min sin aceptar.
 * - Re-avisa cada 15 min hasta 3h (después se da por perdido).
 * - Idempotente por tabla notifications (type='order_nudge', link con
 *   fragmento #nudge-<orderId>). Fail-closed sin CRON_SECRET.
 * - El push reusa el tag `new-order-<id>` del aviso original: reemplaza la
 *   notificación y vuelve a sonar/vibrar (renotify).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const got = new URL(request.url).searchParams.get("secret") || "";
  if (!secret || got !== secret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  let stale: StaleOrder[] = [];
  try {
    stale = await queryMany<StaleOrder>(
      `SELECT o.id, o.vendor_id, o.customer_name, o.total, o.pickup_number,
              o.created_at, o.channel, o.is_preview, v.user_id
       FROM orders o JOIN vendors v ON v.id = o.vendor_id
       WHERE o.status = 'new'
         AND o.channel = 'app'
         AND COALESCE(o.is_preview, false) = false
         AND o.created_at <= now() - ($1 || ' minutes')::interval
         AND o.created_at >= now() - ($2 || ' hours')::interval
       ORDER BY o.created_at ASC
       LIMIT 50`,
      [String(FIRST_NUDGE_MIN), String(MAX_AGE_HOURS)]
    );
  } catch {
    // DB sin columnas channel/is_preview (migración pendiente): fallback a
    // esquema base (en esa época solo existían pedidos app).
    try {
      stale = await queryMany<StaleOrder>(
        `SELECT o.id, o.vendor_id, o.customer_name, o.total, o.pickup_number,
                o.created_at, v.user_id
         FROM orders o JOIN vendors v ON v.id = o.vendor_id
         WHERE o.status = 'new'
           AND o.created_at <= now() - ($1 || ' minutes')::interval
           AND o.created_at >= now() - ($2 || ' hours')::interval
         ORDER BY o.created_at ASC
         LIMIT 50`,
        [String(FIRST_NUDGE_MIN), String(MAX_AGE_HOURS)]
      );
    } catch {
      stale = [];
    }
  }

  let nudged = 0;
  for (const o of stale || []) {
    try {
      if (o.is_preview) continue;
      if (o.channel && o.channel !== "app") continue;
      if (!o.user_id) continue;

      const link = `/vendor/dashboard#nudge-${o.id}`;
      const recent = await queryOne<{ ok: string }>(
        `SELECT '1' AS ok FROM notifications
         WHERE type = 'order_nudge' AND link = $1
           AND created_at > now() - ($2 || ' minutes')::interval
         LIMIT 1`,
        [link, String(NUDGE_EVERY_MIN)]
      ).catch(() => null);
      if (recent) continue;

      const ageMin = Math.max(
        1,
        Math.floor((Date.now() - new Date(o.created_at).getTime()) / 60000)
      );
      const nro = o.pickup_number != null ? ` #${o.pickup_number}` : "";
      const total = Number(o.total || 0).toLocaleString("es-AR");
      const title = `⏰ Pedido${nro} sin aceptar`;
      const body = `${o.customer_name} · $${total} · hace ${ageMin} min — tocá para abrir`;

      await query(
        `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, 'order_nudge', $4)`,
        [o.user_id, title, body, link]
      );
      try {
        await sendPushToUser(o.user_id, {
          title,
          body,
          link: "/vendor/dashboard",
          tag: `new-order-${o.id}`,
          renotify: true,
          requireInteraction: true,
          urgency: "high",
          ttl: 3600,
        });
      } catch {
        /* push best-effort (la in-app ya quedó) */
      }
      nudged++;
    } catch {
      /* sigue con el próximo */
    }
  }

  return NextResponse.json({ ok: true, checked: (stale || []).length, nudged });
}
