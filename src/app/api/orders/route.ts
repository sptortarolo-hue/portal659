import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";
import { sendEmail, orderConfirmationEmail } from "@/lib/email";
import { resolveVendorPlan } from "@/lib/plans";

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
    `SELECT vertical, plan_id, plan_status, plan_expires_at, trial_ends_at FROM vendors WHERE id = $1 LIMIT 1`,
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
  }

  let orderId: string | undefined;

  await withTransaction(async (tx) => {
    const rows = await tx.query<{ id: string }>(
      `INSERT INTO orders (vendor_id, customer_id, customer_name, customer_phone, customer_address, method, payment_method, items, total, status, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', $10)
       RETURNING id`,
      [
        vendorId,
        customerId || null,
        customerName,
        customerPhone,
        customerAddress || null,
        method === "pickup" ? "pickup" : "delivery",
        paymentMethod || "whatsapp",
        items,
        total,
        notes || null,
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
      const emailContent = orderConfirmationEmail(vendor.store_name, items, total);
      await sendEmail({
        to: userProfile.email,
        ...emailContent,
      });
    }
  }

  return NextResponse.json({ ok: true, orderId });
}, { maxRequests: 10 });