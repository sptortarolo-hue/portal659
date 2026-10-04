import { gateRequest } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

/**
 * Profesionales del centro de estética (v1: solo agenda por profesional,
 * sin comisiones). Solo vertical `estetica`. Tolerante a migración sin
 * aplicar (503 con mensaje claro).
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return NextResponse.json({ staff: [] });
  const vendor = gate.vendor;
  if (vendor.vertical !== "estetica") return NextResponse.json({ staff: [] });
  try {
    const staff = await queryMany<Record<string, unknown>>(
      `SELECT * FROM estetica_staff WHERE vendor_id = $1 ORDER BY position ASC, name ASC`,
      [vendor.id]
    );
    return NextResponse.json({ staff: staff || [] });
  } catch {
    return NextResponse.json({ staff: [], migrationMissing: true }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const vendor = gate.vendor;
  if (vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim().slice(0, 120);
  if (!name) return NextResponse.json({ error: "El nombre del profesional es obligatorio" }, { status: 400 });
  const commRaw = body.commission_pct;
  const commissionPct = commRaw == null || commRaw === "" ? null : Number(commRaw);
  if (commissionPct !== null && (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 100)) {
    return NextResponse.json({ error: "La comisión debe estar entre 0 y 100" }, { status: 400 });
  }
  // Sede (multi-sede light): valida que sea del comercio.
  let locationId: string | null = typeof body.location_id === "string" && body.location_id ? body.location_id : null;
  if (locationId) {
    try {
      const loc = await queryOne<{ id: string }>(
        `SELECT id FROM estetica_locations WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [locationId, vendor.id]
      );
      if (!loc) return NextResponse.json({ error: "Sede no encontrada" }, { status: 404 });
    } catch {
      locationId = null;
    }
  }
  // Foto y bio (migración aparte): post-update tolerante.
  const photoRaw = typeof body.photo_url === "string" ? body.photo_url.trim().slice(0, 500) : "";
  const photoUrl = photoRaw && (photoRaw.startsWith("/uploads/") || photoRaw.includes("/uploads/")) ? photoRaw : null;
  const bio = typeof body.bio === "string" ? body.bio.trim().slice(0, 300) : null;
  try {
    let row;
    try {
      row = await queryOne<Record<string, unknown>>(
        `INSERT INTO estetica_staff (vendor_id, name, phone, commission_pct, location_id, active)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          vendor.id,
          name,
          String(body.phone || "").trim().slice(0, 40) || null,
          commissionPct,
          locationId,
          body.active === false ? false : true,
        ]
      );
    } catch {
      try {
        row = await queryOne<Record<string, unknown>>(
          `INSERT INTO estetica_staff (vendor_id, name, phone, commission_pct, active)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [
            vendor.id,
            name,
            String(body.phone || "").trim().slice(0, 40) || null,
            commissionPct,
            body.active === false ? false : true,
          ]
        );
      } catch {
        // Sin migración de comisiones: sin %.
        row = await queryOne<Record<string, unknown>>(
          `INSERT INTO estetica_staff (vendor_id, name, phone, active)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [
            vendor.id,
            name,
            String(body.phone || "").trim().slice(0, 40) || null,
            body.active === false ? false : true,
          ]
        );
      }
    }
    if (photoUrl || bio) {
      try {
        const withPhoto = await queryOne<Record<string, unknown>>(
          `UPDATE estetica_staff SET photo_url = $1, bio = $2 WHERE id = $3 RETURNING *`,
          [photoUrl, bio, (row as { id: string }).id]
        );
        if (withPhoto) row = withPhoto;
      } catch { /* sin columnas: se ignora */ }
    }
    return NextResponse.json({ staff: row });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica.sql en la base" },
      { status: 503 }
    );
  }
}
