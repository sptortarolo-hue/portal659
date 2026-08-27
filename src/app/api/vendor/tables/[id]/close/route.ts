import { gateRequest, gateError } from "@/lib/subscription-gate";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("mesas")) {
    return NextResponse.json({ error: "Las mesas forman parte del plan Gestión integral" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const paymentMethod = ["efectivo", "transferencia", "tarjeta", "mixto", "whatsapp"].includes(body?.paymentMethod)
    ? body.paymentMethod
    : "efectivo";

  const { data: table } = await gate.supabase
    .from("tables")
    .select("id, name, status")
    .eq("id", id)
    .eq("vendor_id", gate.vendor.id)
    .single();

  if (!table) return NextResponse.json({ error: "Mesa no encontrada" }, { status: 404 });
  if (table.status !== "ocupada") {
    return NextResponse.json({ error: "La mesa está libre" }, { status: 400 });
  }

  const { data: orders, error: ordersError } = await gate.supabase
    .from("orders")
    .select("id, total, status, paid_at")
    .eq("vendor_id", gate.vendor.id)
    .eq("table_id", table.id)
    .not("status", "eq", "cancelled");

  if (ordersError) return NextResponse.json({ error: ordersError.message }, { status: 500 });

  const list = orders || [];
  const total = list.reduce((s, o) => s + Number(o.total), 0);
  const now = new Date().toISOString();

  const toUpdate = list.filter((o) => o.status !== "completed");
  if (toUpdate.length > 0) {
    const { error: updateError } = await gate.supabase
      .from("orders")
      .update({ status: "completed", paid_at: now })
      .in("id", toUpdate.map((o) => o.id));
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  } else {
    // ya estaban completadas: solo registrar el cierre de la mesa
    const { error: paidError } = await gate.supabase
      .from("orders")
      .update({ paid_at: now })
      .eq("table_id", table.id)
      .in("id", list.map((o) => o.id));
    if (paidError) return NextResponse.json({ error: paidError.message }, { status: 500 });
  }

  const { error: closeError } = await gate.supabase
    .from("tables")
    .update({ status: "libre" })
    .eq("id", table.id);
  if (closeError) return NextResponse.json({ error: closeError.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    table: { ...table, status: "libre" },
    total,
    ordersClosed: list.length,
    paymentMethod,
  });
}