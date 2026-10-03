import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

/** Editar / activar / borrar una sede. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const sets: string[] = [];
  const vals: unknown[] = [gate.vendor.id, id];
  let idx = 3;
  if (body.name !== undefined) {
    const name = String(body.name || "").trim().slice(0, 120);
    if (!name) return NextResponse.json({ error: "El nombre no puede estar vacío" }, { status: 400 });
    sets.push(`name = $${idx++}`);
    vals.push(name);
  }
  if (body.address !== undefined) {
    sets.push(`address = $${idx++}`);
    vals.push(String(body.address || "").trim().slice(0, 300) || null);
  }
  if (body.phone !== undefined) {
    sets.push(`phone = $${idx++}`);
    vals.push(String(body.phone || "").trim().slice(0, 40) || null);
  }
  if (body.active !== undefined) {
    sets.push(`active = $${idx++}`);
    vals.push(body.active !== false);
  }
  if (sets.length === 0) return NextResponse.json({ error: "Sin cambios" }, { status: 400 });

  try {
    const row = await queryOne<Record<string, unknown>>(
      `UPDATE estetica_locations SET ${sets.join(", ")} WHERE vendor_id = $1 AND id = $2 RETURNING *`,
      vals
    );
    if (!row) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
    return NextResponse.json({ location: row });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica-locations.sql en la base" },
      { status: 503 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }
  const { id } = await params;
  try {
    // Servicios, profesionales y turnos viejos quedan con location en null (SET NULL).
    await queryOne(`DELETE FROM estetica_locations WHERE vendor_id = $1 AND id = $2`, [gate.vendor.id, id]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica-locations.sql en la base" },
      { status: 503 }
    );
  }
}
