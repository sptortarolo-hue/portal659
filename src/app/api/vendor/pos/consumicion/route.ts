import { gateRequest, gateError } from "@/lib/subscription-gate";
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

  const { data: table } = await gate.supabase
    .from("tables")
    .select("id, name, status")
    .eq("id", tableId)
    .eq("vendor_id", gate.vendor.id)
    .single();

  if (!table) return NextResponse.json({ error: "Mesa no encontrada" }, { status: 404 });

  // Si la mesa está libre, se abre automáticamente al cargar la primera consumición
  if (table.status !== "ocupada") {
    await gate.supabase.from("tables").update({ status: "ocupada" }).eq("id", table.id);
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

  const { data, error } = await gate.supabase
    .from("orders")
    .insert({
      vendor_id: gate.vendor.id,
      customer_name: table.name,
      customer_phone: gate.vendor.whatsapp || "",
      customer_address: null,
      method: "pickup",
      payment_method: payment,
      items: normalizedItems,
      total: Number(total),
      status: "new",
      channel: "mesa",
      table_id: table.id,
      notes: notes || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, orderId: data.id, order: data, table });
}