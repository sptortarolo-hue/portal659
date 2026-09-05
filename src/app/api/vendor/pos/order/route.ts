import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne, withTransaction } from "@/lib/db";
import { nextOrderNumber } from "@/lib/order-number";
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
    requires_prep: i.requires_prep !== false,
  }));

  // Pedidos CON cocina o delivery nacen en "preparing" y entran al flow
  // normal de la comanda (hay que prepararlos/despacharlos). Pedidos de
  // mostrador/mesa SIN nada de cocina (solo bebidas/packs) no van a la
  // comanda y usan el flow corto de 2 pasos: new → ready ("Listo").
  const needsKitchen = normalizedItems.some((i) => i.requires_prep !== false);
  const status = needsKitchen || isDelivery ? "preparing" : "new";

  const now = new Date().toISOString();

  // Número de pedido diario universal (mostrador/delivery): además de
  // referenciarlo a la caja, el pedido queda con su número de oraculo en tickets.
  const order = await withTransaction(async (tx) => {
    const pickupNumber = await nextOrderNumber(tx, gate.vendor.id);
    return tx.queryOne<Record<string, any>>(
      `INSERT INTO orders (vendor_id, customer_name, customer_phone, customer_address, method, payment_method, items, total, status, channel, paid_at, notes, pickup_number)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'mostrador', $10, $11, $12)
       RETURNING *`,
      [
        gate.vendor.id,
        customerName?.trim() || "Mostrador",
        isDelivery ? customerPhoneClean : "",
        isDelivery ? (customerAddress?.trim() || null) : null,
        isDelivery ? "delivery" : "pickup",
        payment,
        JSON.stringify(normalizedItems),
        Number(total),
        status,
        now,
        notes || null,
        pickupNumber,
      ]
    );
  });

  return NextResponse.json({ ok: true, orderId: order?.id, order });
}