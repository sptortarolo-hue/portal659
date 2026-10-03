import { gateRequest } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

/** Editar / activar / borrar un servicio del centro de estética. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const vendor = gate.vendor;
  if (vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const sets: string[] = [];
  const vals: unknown[] = [vendor.id, id];
  let idx = 3;
  if (body.name !== undefined) {
    const name = String(body.name || "").trim().slice(0, 120);
    if (!name) return NextResponse.json({ error: "El nombre no puede estar vacío" }, { status: 400 });
    sets.push(`name = $${idx++}`);
    vals.push(name);
  }
  if (body.description !== undefined) {
    sets.push(`description = $${idx++}`);
    vals.push(String(body.description || "").trim().slice(0, 500) || null);
  }
  if (body.duration_min !== undefined) {
    const n = Math.min(480, Math.max(15, Math.floor(Number(body.duration_min) || 60)));
    sets.push(`duration_min = $${idx++}`);
    vals.push(n);
  }
  if (body.buffer_min !== undefined) {
    const n = Math.min(120, Math.max(0, Math.floor(Number(body.buffer_min) || 0)));
    sets.push(`buffer_min = $${idx++}`);
    vals.push(n);
  }
  if (body.deposit_amount !== undefined) {
    const raw = body.deposit_amount;
    const n = raw == null || raw === "" ? null : Number(raw);
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      return NextResponse.json({ error: "La seña debe ser un monto válido" }, { status: 400 });
    }
    sets.push(`deposit_amount = $${idx++}`);
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
  if (body.commission_pct !== undefined) {
    const raw = body.commission_pct;
    const n = raw == null || raw === "" ? null : Number(raw);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) {
      return NextResponse.json({ error: "La comisión debe estar entre 0 y 100" }, { status: 400 });
    }
    sets.push(`commission_pct = $${idx++}`);
    vals.push(n);
  }
  if (body.active !== undefined) {
    sets.push(`active = $${idx++}`);
    vals.push(body.active !== false);
  }
  if (body.location_id !== undefined) {
    const raw = typeof body.location_id === "string" && body.location_id ? body.location_id : null;
    if (raw) {
      try {
        const loc = await queryOne<{ id: string }>(
          `SELECT id FROM estetica_locations WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
          [raw, vendor.id]
        );
        if (!loc) return NextResponse.json({ error: "Sede no encontrada" }, { status: 404 });
      } catch {
        return NextResponse.json(
          { error: "Falta aplicar la migración migrate-estetica-locations.sql en la base" },
          { status: 503 }
        );
      }
    }
    sets.push(`location_id = $${idx++}`);
    vals.push(raw);
  }
  if (sets.length === 0) return NextResponse.json({ error: "Sin cambios" }, { status: 400 });

  try {
    const row = await queryOne<Record<string, unknown>>(
      `UPDATE services SET ${sets.join(", ")} WHERE vendor_id = $1 AND id = $2 RETURNING *`,
      vals
    );
    if (!row) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json({ service: row });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica.sql (o migrate-estetica-commissions.sql para precio/comisión) en la base" },
      { status: 503 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const vendor = gate.vendor;
  if (vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }
  const { id } = await params;
  try {
    // Los turnos viejos quedan con service_id en null (SET NULL).
    await queryOne(`DELETE FROM services WHERE vendor_id = $1 AND id = $2`, [vendor.id, id]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica.sql en la base" },
      { status: 503 }
    );
  }
}
