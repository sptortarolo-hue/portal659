import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne, queryMany, query } from "@/lib/db";
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

  const table = await queryOne<Record<string, any>>(
    `SELECT id, name, status FROM tables WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, gate.vendor.id]
  );

  if (!table) return NextResponse.json({ error: "Mesa no encontrada" }, { status: 404 });
  if (table.status !== "ocupada") {
    return NextResponse.json({ error: "La mesa está libre" }, { status: 400 });
  }

  const orders = await queryMany<Record<string, any>>(
    `SELECT id, total, status, paid_at FROM orders WHERE vendor_id = $1 AND table_id = $2 AND status NOT IN ('cancelled', 'completed')`,
    [gate.vendor.id, table.id]
  );

  const list = orders || [];
  const total = list.reduce((s: number, o: any) => s + Number(o.total), 0);
  const now = new Date().toISOString();

  const toUpdate = list.filter((o) => o.status !== "completed");
  if (toUpdate.length > 0) {
    await query(
      `UPDATE orders SET status = 'completed', paid_at = $1, closed_at = $1 WHERE id = ANY($2)`,
      [now, toUpdate.map((o) => o.id)]
    );
  } else {
    // ya estaban completadas: solo registrar el cierre de la mesa
    await query(
      `UPDATE orders SET paid_at = $1 WHERE table_id = $2 AND id = ANY($3)`,
      [now, table.id, list.map((o) => o.id)]
    );
  }

  await query(`UPDATE tables SET status = 'libre' WHERE id = $1`, [table.id]);

  return NextResponse.json({
    ok: true,
    table: { ...table, status: "libre" },
    total,
    ordersClosed: list.length,
    paymentMethod,
  });
}