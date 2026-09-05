import { queryOne, withTransaction } from "@/lib/db";
import { adjustStockForItems } from "@/lib/stock";
import { sendPushToUser } from "@/lib/push";
import { nextOrderNumber } from "@/lib/order-number";
import { NextResponse } from "next/server";
import crypto from "crypto";

/**
 * Webhook Mercado Pago.
 * Docs: https://www.mercadopago.com.ar/developers/en/docs/your-integrations/notifications/webhooks
 *
 *  - Valida la firma `x-signature` (ts=...,v1=...) con HMAC SHA-256 del manifest
 *    `id:{data.id};request-id:{x-request-id};ts:{ts};`.
 *  - Idempotente: guarda payment_id en `mp_processed_payments`; un reintento de MP
 *    no crea pedido duplicado ni re-descuenta stock.
 */
/**
 * Verifica la firma. `dataIds` son los posibles ids del pago (el de la URL
 * `?data.id=...` y/o el del body `data.id`): MP los usa según el conector.
 */
function verifyMercadoPagoSignature(opts: {
  signatureHeader: string | null;
  dataIds: (string | null)[];
  requestId: string | null;
  webhookSecret: string;
}): boolean {
  const { signatureHeader, dataIds, requestId, webhookSecret } = opts;
  if (!signatureHeader) return false;

  // El header es tipo "ts=1493505724,v1=01d72badd..."  → separo ts y v1.
  const tsMatch = signatureHeader.match(/(?:^|\b)ts=([^,]+)/);
  const v1Match = signatureHeader.match(/(?:^|\b)v1=([^,]+)/);
  const ts = tsMatch?.[1];
  const v1 = v1Match?.[1];
  if (!ts || !v1) return false;

  const b = Buffer.from(v1, "utf8");
  for (const dataId of dataIds) {
    if (!dataId) continue;
    const manifest = `id:${dataId};request-id:${requestId ?? ""};ts:${ts};`;
    const expected = crypto.createHmac("sha256", webhookSecret).update(manifest).digest("hex");
    const a = Buffer.from(expected, "utf8");
    if (a.length !== b.length) continue;
    try {
      // timingSafeEqual: comparación constante, evita timing oracle.
      if (crypto.timingSafeEqual(a, b)) return true;
    } catch { /* noop */ }
  }
  return false;
}

/** Inserta el payment_id; devuelve false si ya estaba procesado (MP reintenta). */
async function claimPaymentId(paymentId: string, tx: Pick<import("@/lib/db").Tx, "query">) {
  const rows = await tx.query<{ payment_id: string }>(
    `INSERT INTO public.mp_processed_payments (payment_id) VALUES ($1)
     ON CONFLICT (payment_id) DO NOTHING RETURNING payment_id`,
    [paymentId]
  );
  return rows.length > 0;
}

export async function POST(request: Request) {
  // El payment id viaja como query param `data.id` (o `id`) y también en el body.
  const url = new URL(request.url);
  const dataIdQuery = url.searchParams.get("data.id") || url.searchParams.get("id");

  const bodyText = await request.text();

  let body: any;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ ok: true });
  }

  if (body.type !== "payment") {
    return NextResponse.json({ ok: true });
  }

  const paymentId = String(body.data?.id || dataIdQuery || "");
  if (!paymentId) return NextResponse.json({ ok: true });

  const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;

  if (MP_WEBHOOK_SECRET) {
    const signature = request.headers.get("x-signature");
    const ok = verifyMercadoPagoSignature({
      signatureHeader: signature,
      dataIds: [dataIdQuery, paymentId],
      requestId: request.headers.get("x-request-id"),
      webhookSecret: MP_WEBHOOK_SECRET,
    });
    if (!ok) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
  if (!MP_ACCESS_TOKEN) return NextResponse.json({ ok: true });

  try {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
    });
    const payment = await res.json();

    if (payment.status !== "approved") {
      return NextResponse.json({ ok: true });
    }

    // ============================================================
    // Idempotencia: primer procesamiento queda marcado; un reintento de MP
    // se reconoce y salta silenciosamente.
    // ============================================================

    const externalRef = payment.external_reference || "";

    // Rama suscripción: portal659_sub_{vendorId}_{planSlug}_{periodStart}
    if (externalRef.startsWith("portal659_sub_")) {
      const parts = externalRef.split("_");
      const vendorId = parts[2];
      const planSlug = parts[3];
      if (vendorId && planSlug) {
        const plan = await queryOne<{ id: string; name: string }>(
          `SELECT id, name FROM plans WHERE slug = $1 LIMIT 1`,
          [planSlug]
        );

        if (plan) {
          const vendor = await queryOne<{ user_id: string; plan_expires_at: string | null }>(
            `SELECT user_id, plan_expires_at FROM vendors WHERE id = $1 LIMIT 1`,
            [vendorId]
          );

          const base = vendor?.plan_expires_at
            ? Math.max(Date.now(), new Date(vendor.plan_expires_at).getTime())
            : Date.now();
          const periodStart = new Date(base).toISOString();
          const periodEnd = new Date(base + 30 * 24 * 60 * 60 * 1000).toISOString();

          const firstTime = await withTransaction(async (tx) => {
            const claimed = await claimPaymentId(paymentId, tx);
            if (!claimed) return false;

            await tx.queryVoid(
              `UPDATE vendors SET plan_id = $1, plan_status = 'active', plan_expires_at = $2 WHERE id = $3`,
              [plan.id, periodEnd, vendorId]
            );

            await tx.queryVoid(
              `INSERT INTO vendor_subscriptions (vendor_id, plan_id, status, current_period_start, current_period_end, note)
               VALUES ($1, $2, 'active', $3, $4, $5)`,
              [vendorId, plan.id, periodStart, periodEnd, `Pago Mercado Pago aprobado — 1 mes ${plan.name}`]
            );

            if (vendor?.user_id) {
              const title = "¡Suscripción activada!";
              const bodyText = `Tu plan ${plan.name} está activo por 1 mes (pago MP).`;
              await tx.queryVoid(
                `INSERT INTO notifications (user_id, title, body, type, link)
                 VALUES ($1, $2, $3, 'payment', '/vendor/suscripcion')`,
                [vendor.user_id, title, bodyText]
              );
            }
            return true;
          });

          if (firstTime && vendor?.user_id) {
            await sendPushToUser(vendor.user_id, {
              title: "¡Suscripción activada!",
              body: `Tu plan ${plan.name} está activo por 1 mes (pago MP).`,
              link: "/vendor/suscripcion",
            }).catch(() => {});
          }
        }
      }

      return NextResponse.json({ ok: true });
    }

    // Rama pedido común (carrito): portal659_{vendorId}_{ts}
    const parts = externalRef.split("_");
    const vendorId = parts[1];
    if (!vendorId) return NextResponse.json({ ok: true });

    const metadata = payment.metadata || {};
    const isPickup = metadata.delivery_method === "pickup";
    const customerPhone = metadata.customer_phone || payment.payer?.phone?.number || "";
    const customerAddress = metadata.customer_address || null;

    const items = payment.additional_info?.items || [];

    // Ítems a guardar en la orden: preferimos los stock_items (vienen resueltos
    // server-side desde /api/payments, con product_id/variant_id y precio).
    // Así al cancelar el pedido se puede reponer el stock.
    let stockItems: unknown[] = [];
    try {
      const raw = metadata.stock_items;
      stockItems = typeof raw === "string" ? JSON.parse(raw) : Array.isArray(raw) ? raw : [];
    } catch {
      stockItems = [];
    }

    // Fallback por si la metadata no tiene stock_items (pedidos muy viejos).
    const itemsForOrder = stockItems.length > 0
      ? stockItems
      : items.map((i: any) => ({
          variant_id: null as string | null,
          product_id: null as string | null,
          name: String(i.title || "Producto"),
          price: Number(i.unit_price),
          qty: Number(i.quantity),
        }));

    const firstTime = await withTransaction(async (tx) => {
      const claimed = await claimPaymentId(paymentId, tx);
      if (!claimed) return false;

      // Número de pedido diario universal (mismo que el canal app/mostrador).
      const pickupNumber = await nextOrderNumber(tx, vendorId);

      const paymentTotal = Number(payment.transaction_amount);
      await tx.queryVoid(
        `INSERT INTO orders (vendor_id, customer_name, customer_phone, customer_address, method, items, total, status, pickup_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', $8)`,
        [
          vendorId,
          payment.payer?.first_name || "Cliente MP",
          customerPhone,
          customerAddress,
          isPickup ? "pickup" : "delivery",
          JSON.stringify(itemsForOrder),
          Number.isFinite(paymentTotal) ? paymentTotal : 0,
          pickupNumber,
        ]
      );

      // Reservar stock (viene en metadata de la preferencia). Si no alcanza,
      // el pedido entra igual: el pago ya fue aprobado por MP.
      try {
        await adjustStockForItems(tx, stockItems as any, "decrement");
      } catch {
        // best-effort: ver nota arriba
      }

      return true;
    });

    if (firstTime) {
      const vendor = await queryOne<{ user_id: string }>(
        `SELECT user_id, store_name FROM vendors WHERE id = $1 LIMIT 1`,
        [vendorId]
      );

      if (vendor?.user_id) {
        const title = "¡Pago aprobado!";
        const bodyText = `Nuevo pago de $${Number(payment.transaction_amount).toLocaleString("es-AR")} vía Mercado Pago`;
        const pushLink = "/vendor/dashboard";
        try {
          await queryOne(
            `INSERT INTO notifications (user_id, title, body, type, link)
             VALUES ($1, $2, $3, 'payment', $4)
             RETURNING id`,
            [vendor.user_id, title, bodyText, pushLink]
          );
        } catch {
          // ignore
        }
        await sendPushToUser(vendor.user_id, { title, body: bodyText, link: pushLink }).catch(() => {});
      }
    }
  } catch {
    // Mercado Pago reintenta; devolvemos 200 para no entrar en retry-loop.
  }

  return NextResponse.json({ ok: true });
}
