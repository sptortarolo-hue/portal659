import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { getDeviceId } from "@/lib/device";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import { sendEmail, orderConfirmationEmail } from "@/lib/email";
import { resolveVendorPlan } from "@/lib/plans";
import { adjustStockForItems, OutOfStockError } from "@/lib/stock";
import { isStoreOpen } from "@/lib/open-hours";
import { PricingError, resolveOrderPricing } from "@/lib/pricing";
import { nextOrderNumber } from "@/lib/order-number";
import { randomBytes } from "crypto";
import type { OrderItem } from "@/types/database";

export const POST = withRateLimit(async (request: Request) => {
  const body = await request.json();
  const {
    vendorId,
    customerName,
    customerPhone,
    customerAddress,
    method,
    paymentMethod,
    customerId,
    items,
    notes,
  } = body;

  if (!vendorId || !customerName || !customerPhone || !items) {
    return NextResponse.json(
      { error: "Faltan datos requeridos" },
      { status: 400 }
    );
  }

  // Gating: el carrito/checkout requiere un plan con la feature cart activa
  const vendorRow = await queryOne<Record<string, unknown>>(
    `SELECT vertical, plan_id, plan_status, plan_expires_at, trial_ends_at, hours, open_override, delivery_fee, free_delivery_min FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );

  if (vendorRow) {
    const planRows = await queryMany<Record<string, unknown>>(`SELECT * FROM plans`);
    const plan = resolveVendorPlan(vendorRow as any, planRows as any);
    if (!plan.can("cart")) {
      return NextResponse.json(
        { error: "Este comercio no acepta pedidos online por ahora. Consultalo directamente por WhatsApp." },
        { status: 403 }
      );
    }

    // Tope mensual de pedidos del plan (canal app, mes calendario, no cancelados).
    // Aplica al Gratuito (20 por defecto); NULL = ilimitado (planes pagos).
    if (plan.maxOrdersMonth != null) {
      const monthCount = await queryOne<{ c: number }>(
        `SELECT count(*)::int AS c FROM orders
          WHERE vendor_id = $1 AND channel = 'app'
            AND status <> 'cancelled'
            AND created_at >= date_trunc('month', now())`,
        [vendorId]
      );
      if ((monthCount?.c ?? 0) >= plan.maxOrdersMonth) {
        return NextResponse.json(
          {
            error:
              `Este comercio alcanzó su límite de ${plan.maxOrdersMonth} pedidos este mes. ` +
              "Probá de nuevo el mes próximo o consultalo directo por WhatsApp.",
          },
          { status: 403 }
        );
      }
    }

    // Abierto/cerrado: el override manual del comercio gana; si no hay override
    // se resuelve por los horarios cargados (timezone Argentina: el server
    // corre en UTC). Cerrado → no se aceptan pedidos online.
    const openNow = isStoreOpen(vendorRow as any);
    if (openNow === false) {
      return NextResponse.json(
        { error: "El comercio está cerrado en este momento. Probá cuando abra o escribile por WhatsApp." },
        { status: 409 }
      );
    }
  }

  let orderId: string | undefined;
  let trackToken: string | undefined;
  let resolvedItems: OrderItem[] = [];
  let resolvedTotal = 0;
  let resolvedItemsCount = 0;

  try {
    await withTransaction(async (tx) => {
      const deviceId = getDeviceId(request);
      const paymentStatus = (paymentMethod || "whatsapp") === "transferencia" ? "pending" : "paid";
      const isPickup = method === "pickup";

      // Precios y stock siempre a partir de la base (nunca del checkout del cliente).
      const pricing = await resolveOrderPricing({
        tx,
        vendorId,
        items,
        method: isPickup ? "pickup" : "delivery",
        deliveryFee: (vendorRow as any)?.delivery_fee,
        freeDeliveryMin: (vendorRow as any)?.free_delivery_min,
      });
      resolvedItems = pricing.items;
      resolvedTotal = pricing.total;
      resolvedItemsCount = pricing.items.reduce((s, i) => s + i.qty, 0);

      // Reserva de stock (moda: variantes o productos con stock_control);
      // se repone si el pedido se cancela/rechaza. Lanza OutOfStockError → 409.
      await adjustStockForItems(tx, resolvedItems, "decrement");

      // Número de pedido correlativo del día (universal: aplica a todos los
      // canales y métodos, para transmitir pedidos al humano "envío Nro 4",
      // "retiro Nro 2"...). Se serializa con advisory lock => no duplica.
      const pickupNumber = await nextOrderNumber(tx, vendorId);

      trackToken = randomBytes(16).toString("hex");

      const rows = await tx.query<{ id: string }>(
        `INSERT INTO orders (vendor_id, customer_id, customer_name, customer_phone, customer_address, method, payment_method, items, total, status, notes, device_id, payment_status, pickup_number, track_token)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', $10, $11, $12, $13, $14)
         RETURNING id`,
        [
          vendorId,
          customerId || null,
          customerName,
          customerPhone,
          customerAddress || null,
          isPickup ? "pickup" : "delivery",
          paymentMethod || "whatsapp",
          JSON.stringify(resolvedItems),
          resolvedTotal,
          notes || null,
          deviceId,
          paymentStatus,
          pickupNumber,
          trackToken,
        ]
      );
      orderId = rows[0]?.id;

      const vendor = await tx.queryOne<{ user_id: string }>(
        `SELECT user_id FROM vendors WHERE id = $1 LIMIT 1`,
        [vendorId]
      );

      if (vendor?.user_id) {
        const paymentLabel = paymentMethod === "efectivo" ? "💵 Efectivo" : paymentMethod === "transferencia" ? "🏦 Transferencia" : "📱 Coordinar";
        await tx.queryVoid(
          `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, $4, $5)`,
          [
            vendor.user_id,
            "Nuevo pedido recibido",
            `Nro. ${pickupNumber} · ${customerName} hizo un pedido de ${resolvedItemsCount} producto${resolvedItemsCount > 1 ? "s" : ""} por $${resolvedTotal.toLocaleString("es-AR")} · ${paymentLabel}`,
            "order",
            "/vendor/dashboard",
          ]
        );
      }
    });
  } catch (e) {
    if (e instanceof OutOfStockError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof PricingError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  if (!orderId) {
    return NextResponse.json({ error: "Error al crear el pedido" }, { status: 500 });
  }

  const vendor = await queryOne<{ user_id: string; store_name: string }>(
    `SELECT user_id, store_name FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );

  if (vendor?.user_id) {
    const userProfile = await queryOne<{ email: string }>(
      `SELECT email FROM profiles WHERE id = $1 LIMIT 1`,
      [vendor.user_id]
    );
    if (userProfile?.email) {
      const emailContent = orderConfirmationEmail(vendor.store_name, resolvedItems as any, resolvedTotal);
      Promise.resolve()
        .then(() => sendEmail({ to: userProfile.email, ...emailContent }))
        .catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, orderId, trackToken, total: resolvedTotal });
}, { maxRequests: 10 });
