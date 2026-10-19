import { query, queryOne, queryMany, withTransaction } from "@/lib/db";
import { sendPushToUser } from "@/lib/push";
import { phoneVariantsAR } from "@/lib/phone";
import { NextResponse } from "next/server";
import { adjustStockForItems, type StockMove } from "@/lib/stock";
import { logStockMovement } from "@/lib/stock-ledger";
import { decrementCustomerFromOrder } from "@/lib/customers";
import type { OrderItem } from "@/types/database";

export const dynamic = "force-dynamic";

const AUTO_CANCEL_REASON = "El pago por transferencia se venció (no registramos tu transferencia)";

type ExpiryOrder = {
  id: string;
  vendor_id: string;
  vendor_name: string;
  user_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  total: number | string;
  pickup_number: number | null;
  transfer_deadline_at: string;
  items: OrderItem[] | null;
  is_preview: boolean | null;
};

/**
 * Auto-cancel de transferencias vencidas (cron en el host cada 20 min):
 *   GET /api/cron/transfer-expiry?secret=...
 * - Pedidos canal "app", transferencia pendiente, con deadline pasado.
 * - Cancela con motivo "transferencia vencida", repone stock, anula
 *   giftcards emitidas, sale del CRM y avisa al cliente (push + in-app).
 * - Aviso temprano al comercio: deadline dentro de la próxima hora → un
 *   aviso por pedido (type='transfer_expiry_warn', idempotente por link).
 * - Stop de seguridad: a los pedidos ya avisados (M4.1 legacy: sin la
 *   columna transfer_deadline_at) no se les hace nada (fallback silencioso).
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  const got = new URL(request.url).searchParams.get("secret") || "";
  if (!secret || got !== secret) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  // Aviso temprano (T-1h): transferencias por vencer sin aviso previo.
  let warned = 0;
  {
    const soon = await queryMany<ExpiryOrder>(
      `SELECT o.id, o.vendor_id, v.store_name AS vendor_name, v.user_id,
              o.customer_name, o.customer_phone, o.total, o.pickup_number,
              o.transfer_deadline_at, o.items, o.is_preview
       FROM orders o JOIN vendors v ON v.id = o.vendor_id
       WHERE o.status = 'new'
         AND o.channel = 'app'
         AND o.payment_method = 'transferencia'
         AND o.payment_status = 'pending'
         AND COALESCE(o.is_preview, false) = false
         AND o.transfer_deadline_at IS NOT NULL
         AND o.transfer_deadline_at > now()
         AND o.transfer_deadline_at <= now() + interval '1 hour'
         AND NOT EXISTS (
           SELECT 1 FROM notifications n
           WHERE n.type = 'transfer_expiry_warn' AND n.link = $1 || o.id
         )
       ORDER BY o.transfer_deadline_at ASC
       LIMIT 50`,
      ["/vendor/dashboard#expiry-"]
    ).catch(() => [] as ExpiryOrder[]);
    for (const o of soon || []) {
      try {
        if (!o.user_id) continue;
        const link = `/vendor/dashboard#expiry-${o.id}`;
        const mins = Math.max(
          1,
          Math.round((new Date(o.transfer_deadline_at).getTime() - Date.now()) / 60000)
        );
        const title = `⏳ Transferencia por vencer`;
        const body = `Pedido${o.pickup_number != null ? ` #${o.pickup_number}` : ` ${o.customer_name}`} · $${Number(o.total).toLocaleString("es-AR")} · vence en ~${mins < 60 ? `${mins} min` : "1 h"}. Si ya pagó, marcalo cobrado`;
        await query(
          `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, 'transfer_expiry_warn', $4)`,
          [o.user_id, title, body, link]
        );
        try {
          await sendPushToUser(o.user_id, { title, body, link: "/vendor/dashboard" });
        } catch {
          /* push best-effort */
        }
        warned++;
      } catch {
        /* sigue con el próximo */
      }
    }
  }

  // Vencidos: auto-cancel con motivo + repuesto de stock + aviso al cliente.
  let cancelled = 0;
  {
    const overdue = await queryMany<ExpiryOrder>(
      `SELECT o.id, o.vendor_id, v.store_name AS vendor_name, v.user_id,
              o.customer_name, o.customer_phone, o.total, o.pickup_number,
              o.transfer_deadline_at, o.items, o.is_preview
       FROM orders o JOIN vendors v ON v.id = o.vendor_id
       WHERE o.status = 'new'
         AND o.channel = 'app'
         AND o.payment_method = 'transferencia'
         AND o.payment_status = 'pending'
         AND COALESCE(o.is_preview, false) = false
         AND o.transfer_deadline_at IS NOT NULL
         AND o.transfer_deadline_at <= now()
       ORDER BY o.transfer_deadline_at ASC
       LIMIT 25`
    ).catch(() => [] as ExpiryOrder[]);
    for (const o of overdue || []) {
      try {
        await withTransaction(async (tx) => {
          // Repuesto de stock (tolerante: por peso nunca tocó stock).
          const items = (o.items || []) as OrderItem[];
          const returnedStock: StockMove[] = await adjustStockForItems(
            tx,
            items.filter((i) => (i as any)?.unit !== "kg"),
            "increment"
          );
          for (const m of returnedStock) {
            await logStockMovement(tx, {
              vendorId: o.vendor_id,
              product_id: m.product_id,
              variant_id: m.variant_id,
              qty_delta: m.qty,
              reason: "devolucion",
              ref_order: o.id,
            });
          }
          const upd = await tx.query<{ cancelled: boolean }>(
            `UPDATE orders
              SET status = 'cancelled', closed_at = $2,
                  cancel_reason = $3,
                  cancelled_by = CASE WHEN EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'orders' AND column_name = 'cancelled_by'
                  ) THEN $4 ELSE NULL END
              WHERE id = $1
                AND status = 'new'
                AND payment_status = 'pending'
              RETURNING '1' AS cancelled`,
            [o.id, new Date().toISOString(), AUTO_CANCEL_REASON, "Sistema (venció la transferencia)"]
          );
          if (upd.length === 0) return; // ya no estaba (race): no hacemos nada más
          await tx.queryVoid(`INSERT INTO order_status_log (order_id, status) VALUES ($1, 'cancelled')`, [o.id]);
          // Giftcards emitidas por esta venta: anular (best-effort).
          try {
            const { voidGiftcardsForOrder } = await import("@/lib/giftcards");
            await voidGiftcardsForOrder(tx, { vendorId: o.vendor_id, orderId: o.id, note: "transferencia vencida" });
          } catch {
            /* best-effort */
          }
          // CRM: la compra cancelada sale del libro (teléfono real).
          if (o.customer_phone && !o.customer_phone.startsWith("lid:")) {
            await decrementCustomerFromOrder(tx, o.vendor_id, {
              phone: o.customer_phone,
              total: Number(o.total),
            }).catch(() => undefined);
          }
        });

        // Aviso al comercio + al cliente (fuera de la tx, best-effort).
        try {
          if (o.user_id) {
            const title = `💸 Transferencia vencida`;
            const body = `Pedido${o.pickup_number != null ? ` #${o.pickup_number}` : ` ${o.customer_name}`} · $${Number(o.total).toLocaleString("es-AR")} se canceló solo (no registramos el pago). El stock se repuso.`;
            await query(
              `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, 'transfer_expiry', $4)`,
              [o.user_id, title, body, `/vendor/dashboard#expiry-${o.id}`]
            );
          }
          if (o.customer_phone && !o.customer_phone.startsWith("lid:")) {
            const phoneVariants = phoneVariantsAR(o.customer_phone);
            const profile = await queryOne<{ id: string }>(
              `SELECT id FROM profiles
               WHERE regexp_replace(phone, '[^0-9]', '', 'g') = ANY($1)
                  OR regexp_replace(whatsapp, '[^0-9]', '', 'g') = ANY($1)
               LIMIT 1`,
              [phoneVariants]
            );
            if (profile) {
              const title = "Tu pedido fue cancelado";
              const nro = o.pickup_number != null ? ` Nro. ${o.pickup_number}` : "";
              const body = `${o.vendor_name} canceló tu pedido${nro} — el pago no llegó en el tiempo acordado. Consultá con ${o.vendor_name}.`;
              await query(
                `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, 'order', '/mis-pedidos')`,
                [profile.id, title, body]
              );
              try {
                await sendPushToUser(profile.id, { title, body, link: "/mis-pedidos" });
              } catch {
                /* push best-effort */
              }
            }
          }
        } catch {
          /* avisos best-effort */
        }
        cancelled++;
      } catch {
        /* sigue con el próximo */
      }
    }
  }

  return NextResponse.json({ ok: true, warned, cancelled });
}
