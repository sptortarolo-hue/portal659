import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

export async function PATCH(
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

  const payload: Record<string, unknown> = {};
  if (body.name !== undefined) payload.name = String(body.name).trim();
  if (body.capacity !== undefined) payload.capacity = Number(body.capacity) > 0 ? Number(body.capacity) : 4;
  if (body.status !== undefined && ["libre", "ocupada", "reservada"].includes(body.status)) {
    payload.status = body.status;
  }
  if (body.position !== undefined) payload.position = Number(body.position);

  if (Object.keys(payload).length === 0) {
    return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
  }

  const setClauses: string[] = [];
  const values: unknown[] = [id, gate.vendor.id];
  let idx = 3;
  for (const [key, val] of Object.entries(payload)) {
    setClauses.push(`${key} = $${idx}`);
    values.push(val);
    idx++;
  }

  const table = await queryOne<Record<string, unknown>>(
    `UPDATE tables SET ${setClauses.join(", ")} WHERE id = $1 AND vendor_id = $2 RETURNING *`,
    values
  );

  return NextResponse.json({ table });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("mesas")) {
    return NextResponse.json({ error: "Las mesas forman parte del plan Gestión integral" }, { status: 403 });
  }

  const { id } = await params;

  // Una mesa ocupada no se puede borrar
  const table = await queryOne<{ status: string }>(
    `SELECT status FROM tables WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, gate.vendor.id]
  );

  if (!table) return NextResponse.json({ error: "Mesa no encontrada" }, { status: 404 });
  if (table.status === "ocupada") {
    return NextResponse.json({ error: "La mesa está ocupada. Cerrá la mesa antes de eliminarla." }, { status: 400 });
  }

  await queryOne(`DELETE FROM tables WHERE id = $1 AND vendor_id = $2 RETURNING id`, [id, gate.vendor.id]);
  return NextResponse.json({ ok: true });
}