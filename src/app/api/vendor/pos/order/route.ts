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
    notes,
    paid,
  } = body;

  if (!items || !Array.isArray(items) || items.length === 0 || !total) {
    return NextResponse.json({ error: "Faltan productos o total" }, { status: 400 });
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

  const order = await queryOne<Record<string, any>>(
    `INSERT INTO orders (vendor_id, customer_name, customer_phone, customer_address, method, payment_method, items, total, status, channel, paid_at, notes)
     VALUES ($1, $2, $3, $4, 'pickup', $5, $6, $7, 'new', 'mostrador', $8, $9)
     RETURNING *`,
    [
      gate.vendor.id,
      customerName?.trim() || "Mostrador",
      gate.vendor.whatsapp || "",
      null,
      payment,
      JSON.stringify(normalizedItems),
      Number(total),
      paid ? now : null,
      notes || null,
    ]
  );

  return NextResponse.json({ ok: true, orderId: order?.id, order });
}