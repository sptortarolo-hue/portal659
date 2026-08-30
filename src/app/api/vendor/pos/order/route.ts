import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

const PAYMENT_METHODS = ["efectivo", "transferencia", "tarjeta", "mixto", "whatsapp"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);

  if (!gate.plan.can("pos")) {
    return NextResponse.json(
      { error: "El mostrador forma parte del plan Gestión integral" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const {
    items,
    total,
    paymentMethod,
    customerName,
    customerPhone,
    customerAddress,
    method,
    notes,
  } = body;

  if (!items || !Array.isArray(items) || items.length === 0 || !total) {
    return NextResponse.json({ error: "Faltan productos o total" }, { status: 400 });
  }

  const isDelivery = method === "delivery";
  const customerPhoneClean = typeof customerPhone === "string" ? customerPhone.trim() : "";

  if (isDelivery && !customerPhoneClean) {
    return NextResponse.json({ error: "El envío a domicilio requiere el teléfono del cliente" }, { status: 400 });
  }

  const payment = (PAYMENT_METHODS as readonly string[]).includes(paymentMethod)
    ? (paymentMethod as PaymentMethod)
    : "efectivo";

  const normalizedItems = items.map((i: any) => ({
    product_id: i.product_id || undefined,
    name: i.name,
    price: Number(i.price),
    qty: Number(i.qty) || 1,
    modifiers: Array.isArray(i.modifiers) && i.modifiers.length > 0 ? i.modifiers : undefined,
  }));

  const now = new Date().toISOString();

  // Número de retiro correlativo por día (solo para retiro en local).
  let pickupNumber: number | null = null;
  if (!isDelivery) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const lastRow = await queryOne<{ n: number }>(
      `SELECT COALESCE(MAX(pickup_number), 0)::int AS n
       FROM orders
       WHERE vendor_id = $1 AND pickup_number IS NOT NULL AND created_at >= $2`,
      [gate.vendor.id, todayStart.toISOString()]
    );
    pickupNumber = (lastRow?.n ?? 0) + 1;
  }

  const order = await queryOne<Record<string, any>>(
    `INSERT INTO orders (vendor_id, customer_name, customer_phone, customer_address, method, payment_method, items, total, status, channel, paid_at, notes, pickup_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'preparing', 'mostrador', $9, $10, $11)
     RETURNING *`,
    [
      gate.vendor.id,
      customerName?.trim() || "Mostrador",
      isDelivery ? customerPhoneClean : (gate.vendor.whatsapp || ""),
      isDelivery ? (customerAddress?.trim() || null) : null,
      isDelivery ? "delivery" : "pickup",
      payment,
      JSON.stringify(normalizedItems),
      Number(total),
      now,
      notes || null,
      pickupNumber,
    ]
  );

  return NextResponse.json({ ok: true, orderId: order?.id, order });
}