import { query, queryOne, withTransaction } from "@/lib/db";
import { adjustStockForItems } from "@/lib/stock";
import { sendPushToUser } from "@/lib/push";
import { NextResponse } from "next/server";
import crypto from "crypto";

function verifyMercadoPagoSignature(
  body: string,
  signatureHeader: string | null,
  webhookSecret: string
): boolean {
  if (!signatureHeader) return false;
  const parts = signatureHeader.split(",");
  if (parts.length < 3) return false;
  const hash = parts[2];
  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(body)
    .digest("hex");
  return hash === expected;
}

export async function POST(request: Request) {
  const bodyText = await request.text();
  const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET;

  if (MP_WEBHOOK_SECRET) {
    const signature = request.headers.get("x-signature");
    if (!verifyMercadoPagoSignature(bodyText, signature, MP_WEBHOOK_SECRET)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const body = JSON.parse(bodyText);

  if (body.type === "payment") {
    const paymentId = body.data?.id;
    if (!paymentId) return NextResponse.json({ ok: true });

    const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    if (!MP_ACCESS_TOKEN) return NextResponse.json({ ok: true });

    try {
      const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
      });
      const payment = await res.json();

      if (payment.status === "approved") {
        const externalRef = payment.external_reference;

        // Rama suscripción: portal659_sub_{vendorId}_{planSlug}_{periodStart}
        if (externalRef?.startsWith("portal659_sub_")) {
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

              await query(
                `UPDATE vendors SET plan_id = $1, plan_status = 'active', plan_expires_at = $2 WHERE id = $3`,
                [plan.id, periodEnd, vendorId]
              );

              await query(
                `INSERT INTO vendor_subscriptions (vendor_id, plan_id, status, current_period_start, current_period_end, note)
                 VALUES ($1, $2, 'active', $3, $4, $5)`,
                [vendorId, plan.id, periodStart, periodEnd, `Pago Mercado Pago aprobado — 1 mes ${plan.name}`]
              );

              if (vendor?.user_id) {
                const title = "¡Suscripción activada!";
                const body = `Tu plan ${plan.name} está activo por 1 mes (pago MP).`;
                await query(
                  `INSERT INTO notifications (user_id, title, body, type, link)
                   VALUES ($1, $2, $3, 'payment', '/vendor/suscripcion')`,
                  [vendor.user_id, title, body]
                );
                await sendPushToUser(vendor.user_id, { title, body, link: "/vendor/suscripcion" });
              }
            }
          }

          return NextResponse.json({ ok: true });
        }

        const parts = externalRef.split("_");
        const vendorId = parts[1];

        const metadata = payment.metadata || {};
        const isPickup = metadata.delivery_method === "pickup";
        const customerPhone = metadata.customer_phone || payment.payer?.phone?.number || "";
        const customerAddress = metadata.customer_address || null;

        // Número de retiro correlativo por día (solo si es retiro en local).
        let pickupNumber: number | null = null;
        if (isPickup) {
          const todayStart = new Date();
          todayStart.setHours(0, 0, 0, 0);
          const lastRow = await queryOne<{ n: number }>(
            `SELECT COALESCE(MAX(pickup_number), 0)::int AS n
             FROM orders
             WHERE vendor_id = $1 AND pickup_number IS NOT NULL AND created_at >= $2`,
            [vendorId, todayStart.toISOString()]
          );
          pickupNumber = (lastRow?.n ?? 0) + 1;
        }

        const items = payment.additional_info?.items || [];
        await withTransaction(async (tx) => {
          await tx.queryVoid(
            `INSERT INTO orders (vendor_id, customer_name, customer_phone, customer_address, method, items, total, status, pickup_number)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'new', $8)`,
            [
              vendorId,
              payment.payer?.first_name || "Cliente MP",
              customerPhone,
              customerAddress,
              isPickup ? "pickup" : "delivery",
              JSON.stringify(items.map((i: any) => ({
                name: i.title,
                price: Number(i.unit_price),
                qty: Number(i.quantity),
              }))),
              payment.transaction_amount,
              pickupNumber,
            ]
          );

          // Reservar stock (viene en metadata de la preferencia). Si no alcanza,
          // el pedido entra igual: el pago ya fue aprobado por MP.
          try {
            const raw = (metadata as Record<string, unknown>).stock_items;
            const stockItems = typeof raw === "string" ? JSON.parse(raw) : [];
            await adjustStockForItems(tx, stockItems, "decrement");
          } catch {
            // best-effort: ver nota arriba
          }
        });

        const vendor = await queryOne<{ user_id: string }>(
          `SELECT user_id, store_name FROM vendors WHERE id = $1 LIMIT 1`,
          [vendorId]
        );

        if (vendor?.user_id) {
          const title = "¡Pago aprobado!";
          const body = `Nuevo pago de $${Number(payment.transaction_amount).toLocaleString("es-AR")} vía Mercado Pago`;
          await query(
            `INSERT INTO notifications (user_id, title, body, type, link)
             VALUES ($1, $2, $3, 'payment', '/vendor/dashboard')`,
            [vendor.user_id, title, body]
          );
          await sendPushToUser(vendor.user_id, { title, body, link: "/vendor/dashboard" });
        }
      }
    } catch {
      // Mercado Pago reintenta, no fallar
    }
  }

  return NextResponse.json({ ok: true });
}