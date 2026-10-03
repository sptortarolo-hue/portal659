import { gateRequest } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

/**
 * Catálogo de servicios del centro de estética (v1): nombre + duración +
 * buffer + seña propia opcional. Solo vertical `estetica`. Todo tolerante a
 * migración sin aplicar (responde 503 con mensaje claro).
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return NextResponse.json({ services: [] });
  const vendor = gate.vendor;
  if (vendor.vertical !== "estetica") return NextResponse.json({ services: [] });
  try {
    const services = await queryMany<Record<string, unknown>>(
      `SELECT * FROM services WHERE vendor_id = $1 ORDER BY position ASC, name ASC`,
      [vendor.id]
    );
    return NextResponse.json({ services: services || [] });
  } catch {
    return NextResponse.json(
      { services: [], migrationMissing: true },
      { status: 503 }
    );
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
  if (!name) return NextResponse.json({ error: "El nombre del servicio es obligatorio" }, { status: 400 });
  const durationMin = Math.min(480, Math.max(15, Math.floor(Number(body.duration_min) || 60)));
  const bufferMin = Math.min(120, Math.max(0, Math.floor(Number(body.buffer_min) || 0)));
  const depositRaw = body.deposit_amount;
  const depositAmount =
    depositRaw == null || depositRaw === ""
      ? null
      : Number(depositRaw);
  if (depositAmount !== null && (!Number.isFinite(depositAmount) || depositAmount < 0)) {
    return NextResponse.json({ error: "La seña debe ser un monto válido" }, { status: 400 });
  }
  const priceRaw = body.price;
  const price = priceRaw == null || priceRaw === "" ? null : Number(priceRaw);
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    return NextResponse.json({ error: "El precio debe ser un monto válido" }, { status: 400 });
  }
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
      // Sin tabla de sedes: se ignora (tolerante a migración sin aplicar).
      locationId = null;
    }
  }
  try {
    let row;
    try {
      row = await queryOne<Record<string, unknown>>(
        `INSERT INTO services (vendor_id, name, description, duration_min, buffer_min, deposit_amount, price, commission_pct, location_id, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
        [
          vendor.id,
          name,
          String(body.description || "").trim().slice(0, 500) || null,
          durationMin,
          bufferMin,
          depositAmount,
          price,
          commissionPct,
          locationId,
          body.active === false ? false : true,
        ]
      );
    } catch {
      try {
        row = await queryOne<Record<string, unknown>>(
          `INSERT INTO services (vendor_id, name, description, duration_min, buffer_min, deposit_amount, price, commission_pct, active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [
            vendor.id,
            name,
            String(body.description || "").trim().slice(0, 500) || null,
            durationMin,
            bufferMin,
            depositAmount,
            price,
            commissionPct,
            body.active === false ? false : true,
          ]
        );
      } catch {
        // Sin migración de comisiones: sin precio ni %.
        row = await queryOne<Record<string, unknown>>(
          `INSERT INTO services (vendor_id, name, description, duration_min, buffer_min, deposit_amount, active)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [
            vendor.id,
            name,
            String(body.description || "").trim().slice(0, 500) || null,
            durationMin,
            bufferMin,
            depositAmount,
            body.active === false ? false : true,
          ]
        );
      }
    }
    return NextResponse.json({ service: row });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica.sql en la base" },
      { status: 503 }
    );
  }
}
