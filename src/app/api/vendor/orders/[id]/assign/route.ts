import { NextResponse } from "next/server";
import { queryOne, query } from "@/lib/db";
import { getVendorByRequest } from "@/lib/vendor-utils";

// Asigna o libera un pedido a un repartidor.
// claim   → toma el pedido (solo si está sin asignar y en ready/sent)
// release → lo devuelve al pool
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { vendor, userId, staffRole } = await getVendorByRequest(request);
  if (!vendor || !userId) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const action = body.action === "release" ? "release" : "claim";

  const order = await queryOne<{ id: string; assigned_to: string | null; status: string }>(
    `SELECT id, assigned_to, status FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [params.id, vendor.id]
  );
  if (!order) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });

  if (action === "claim") {
    if (!["ready", "sent"].includes(order.status)) {
      return NextResponse.json({ error: "Este pedido no está listo para entregar" }, { status: 400 });
    }
    if (order.assigned_to) {
      return NextResponse.json({ error: "El pedido ya lo tomó otro repartidor" }, { status: 409 });
    }
    await query(`UPDATE orders SET assigned_to = $1, claimed_at = now() WHERE id = $2`, [userId, params.id]);
    return NextResponse.json({ ok: true, assigned: true });
  }

  // release
  if (order.assigned_to !== userId) {
    return NextResponse.json({ error: "No tenés este pedido asignado" }, { status: 403 });
  }
  await query(`UPDATE orders SET assigned_to = NULL, claimed_at = NULL WHERE id = $1`, [params.id]);
  return NextResponse.json({ ok: true, assigned: false });
}