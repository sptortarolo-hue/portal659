import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

/** Editar / activar / borrar un pack de sesiones. */
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
  if (body.sessions_total !== undefined) {
    const n = Math.min(100, Math.max(1, Math.floor(Number(body.sessions_total) || 0)));
    if (!n) return NextResponse.json({ error: "Sesiones inválidas" }, { status: 400 });
    sets.push(`sessions_total = $${idx++}`);
    vals.push(n);
  }
  if (body.price !== undefined) {
    const raw = body.price;
    const n = raw == null || raw === "" ? null : Number(raw);
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      return NextResponse.json({ error: "El precio debe ser un monto válido" }, { status: 400 });
    }
    sets.push(`price = $${idx++}`);
    vals.push(n);
  }
  if (body.active !== undefined) {
    sets.push(`active = $${idx++}`);
    vals.push(body.active !== false);
  }
  if (sets.length === 0) return NextResponse.json({ error: "Sin cambios" }, { status: 400 });

  try {
    const pack = await queryOne<Record<string, unknown>>(
      `UPDATE service_packs SET ${sets.join(", ")} WHERE vendor_id = $1 AND id = $2 RETURNING *`,
      vals
    );
    if (!pack) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json({ pack });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica.sql en la base" },
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
    await queryOne(`DELETE FROM service_packs WHERE vendor_id = $1 AND id = $2`, [gate.vendor.id, id]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica.sql en la base" },
      { status: 503 }
    );
  }
}
