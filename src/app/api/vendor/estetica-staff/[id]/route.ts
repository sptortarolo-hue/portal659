import { gateRequest } from "@/lib/subscription-gate";
import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

/** Editar / activar / borrar un profesional del centro de estética. */
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
  if (body.phone !== undefined) {
    sets.push(`phone = $${idx++}`);
    vals.push(String(body.phone || "").trim().slice(0, 40) || null);
  }
  if (body.active !== undefined) {
    sets.push(`active = $${idx++}`);
    vals.push(body.active !== false);
  }
  if (body.photo_url !== undefined) {
    const raw = typeof body.photo_url === "string" ? body.photo_url.trim().slice(0, 500) : "";
    sets.push(`photo_url = $${idx++}`);
    vals.push(raw && (raw.startsWith("/uploads/") || raw.includes("/uploads/")) ? raw : null);
  }
  if (body.bio !== undefined) {
    sets.push(`bio = $${idx++}`);
    vals.push(typeof body.bio === "string" ? body.bio.trim().slice(0, 300) || null : null);
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
  if (body.commission_pct !== undefined) {
    const raw = body.commission_pct;
    const n = raw == null || raw === "" ? null : Number(raw);
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100)) {
      return NextResponse.json({ error: "La comisión debe estar entre 0 y 100" }, { status: 400 });
    }
    sets.push(`commission_pct = $${idx++}`);
    vals.push(n);
  }
  if (sets.length === 0) return NextResponse.json({ error: "Sin cambios" }, { status: 400 });

  try {
    const row = await queryOne<Record<string, unknown>>(
      `UPDATE estetica_staff SET ${sets.join(", ")} WHERE vendor_id = $1 AND id = $2 RETURNING *`,
      vals
    );
    if (!row) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
    return NextResponse.json({ staff: row });
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
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const vendor = gate.vendor;
  if (vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }
  const { id } = await params;
  try {
    // Los turnos viejos quedan con staff_id en null (SET NULL).
    await queryOne(`DELETE FROM estetica_staff WHERE vendor_id = $1 AND id = $2`, [vendor.id, id]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica.sql en la base" },
      { status: 503 }
    );
  }
}
