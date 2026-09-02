import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne, query } from "@/lib/db";
import { NextResponse } from "next/server";

const PAYMENT_METHODS = ["efectivo", "transferencia", "tarjeta", "mixto", "whatsapp"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);

  if (!gate.plan.can("mesas")) {
    return NextResponse.json(
      { error: "Las mesas forman parte del plan Gestión integral" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { tableId, items, total, paymentMethod, notes } = body;

  if (!tableId) return NextResponse.json({ error: "Falta la mesa" }, { status: 400 });
  if (!items || !Array.isArray(items) || items.length === 0 || !total) {
    return NextResponse.json({ error: "Faltan productos o total" }, { status: 400 });
  }

  const table = await queryOne<Record<string, any>>(
    `SELECT id, name, status FROM tables WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [tableId, gate.vendor.id]
  );
  if (!table) return NextResponse.json({ error: "Mesa no encontrada" }, { status: 404 });

  // Si la mesa está libre, se abre automáticamente al cargar la primera consumición
  if (table.status !== "ocupada") {
    await query(`UPDATE tables SET status = 'ocupada' WHERE id = $1`, [table.id]);
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

  const order = await queryOne<Record<string, any>>(
    `INSERT INTO orders (vendor_id, customer_name, customer_phone, customer_address, method, payment_method, items, total, status, channel, table_id, notes)
     VALUES ($1, $2, $3, $4, 'pickup', $5, $6, $7, 'new', 'mesa', $8, $9)
     RETURNING *`,
    [
      gate.vendor.id,
      table.name,
      gate.vendor.whatsapp || "",
      null,
      payment,
      JSON.stringify(normalizedItems),
      Number(total),
      table.id,
      notes || null,
    ]
  );

  return NextResponse.json({ ok: true, orderId: order?.id, order, table });
}