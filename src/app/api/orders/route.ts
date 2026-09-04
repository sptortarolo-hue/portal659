import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { getDeviceId } from "@/lib/device";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import { sendEmail, orderConfirmationEmail } from "@/lib/email";
import { resolveVendorPlan } from "@/lib/plans";
import { adjustStockForItems, OutOfStockError } from "@/lib/stock";
import { isStoreOpen } from "@/lib/open-hours";

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
    total,
    notes,
  } = body;

  if (!vendorId || !customerName || !customerPhone || !items || !total) {
    return NextResponse.json(
      { error: "Faltan datos requeridos" },
      { status: 400 }
    );
  }

  // Gating: el carrito/checkout requiere un plan con la feature cart activa
  const vendorRow = await queryOne<Record<string, unknown>>(
    `SELECT vertical, plan_id, plan_status, plan_expires_at, trial_ends_at, hours, open_override FROM vendors WHERE id = $1 LIMIT 1`,
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
  // Guardamos product_id/variant_id para poder reservar (y reponer) stock.
  const normalizedItems = (Array.isArray(items) ? items : []).map((i: any) => ({
    product_id: typeof i.offerId === "string" ? i.offerId : undefined,
    variant_id: typeof i.variantId === "string" ? i.variantId : undefined,
    name: i.name,
    price: Number(i.price),
    qty: Number(i.qty) || 1,
    modifiers: Array.isArray(i.modifiers) && i.modifiers.length > 0 ? i.modifiers : undefined,
  }));

  try {
    await withTransaction(async (tx) => {
    const deviceId = getDeviceId(request);
    const paymentStatus = (paymentMethod || "whatsapp") === "transferencia" ? "pending" : "paid";
    const isPickup = method === "pickup";

    // Reserva de stock (moda: variantes o productos con stock_control);
    // se repone si el pedido se cancela/rechaza. Lanza OutOfStockError → 409.
    await adjustStockForItems(tx, normalizedItems, "decrement");

    let pickupNumber: number | null = null;
    if (isPickup) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const lastRow = await tx.queryOne<{ n: number }>(
        `SELECT COALESCE(MAX(pickup_number), 0)::int AS n
         FROM orders
         WHERE vendor_id = $1 AND pickup_number IS NOT NULL AND created_at >= $2`,
        [vendorId, todayStart.toISOString()]
      );
      pickupNumber = (lastRow?.n ?? 0) + 1;
    }

    const rows = await tx.query<{ id: string }>(
      `INSERT INTO orders (vendor_id, customer_id, customer_name, customer_phone, customer_address, method, payment_method, items, total, status, notes, device_id, payment_status, pickup_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', $10, $11, $12, $13)
       RETURNING id`,
      [
        vendorId,
        customerId || null,
        customerName,
        customerPhone,
        customerAddress || null,
        isPickup ? "pickup" : "delivery",
        paymentMethod || "whatsapp",
        JSON.stringify(normalizedItems),
        total,
        notes || null,
        deviceId,
        paymentStatus,
        pickupNumber,
      ]
    );
    orderId = rows[0]?.id;

    const vendor = await tx.queryOne<{ user_id: string }>(
      `SELECT user_id FROM vendors WHERE id = $1 LIMIT 1`,
      [vendorId]
    );

    if (vendor?.user_id) {
      const itemCount = items.reduce((s: number, i: any) => s + i.qty, 0);
      const paymentLabel = paymentMethod === "efectivo" ? "💵 Efectivo" : paymentMethod === "transferencia" ? "🏦 Transferencia" : "📱 Coordinar";
      await tx.queryVoid(
        `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, $4, $5)`,
        [
          vendor.user_id,
          "Nuevo pedido recibido",
          `${customerName} hizo un pedido de ${itemCount} producto${itemCount > 1 ? "s" : ""} por $${Number(total).toLocaleString("es-AR")} · ${paymentLabel}`,
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
      const emailContent = orderConfirmationEmail(vendor.store_name, normalizedItems as any, Number(total));
      Promise.resolve()
        .then(() => sendEmail({ to: userProfile.email, ...emailContent }))
        .catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, orderId });
}, { maxRequests: 10 });