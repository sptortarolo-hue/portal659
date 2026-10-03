import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

/**
 * Sedes del centro de estética (multi-sede light v1: entidades + asignación,
 * sin agendas separadas). Solo vertical `estetica`.
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "estetica") return NextResponse.json({ locations: [] });
  try {
    const locations = await queryMany<Record<string, unknown>>(
      `SELECT * FROM estetica_locations WHERE vendor_id = $1 ORDER BY position ASC, name ASC`,
      [gate.vendor.id]
    );
    return NextResponse.json({ locations: locations || [] });
  } catch {
    return NextResponse.json({ locations: [], migrationMissing: true }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim().slice(0, 120);
  if (!name) return NextResponse.json({ error: "El nombre de la sede es obligatorio" }, { status: 400 });
  try {
    const row = await queryOne<Record<string, unknown>>(
      `INSERT INTO estetica_locations (vendor_id, name, address, phone, active)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [
        gate.vendor.id,
        name,
        String(body.address || "").trim().slice(0, 300) || null,
        String(body.phone || "").trim().slice(0, 40) || null,
        body.active === false ? false : true,
      ]
    );
    return NextResponse.json({ location: row });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica-locations.sql en la base" },
      { status: 503 }
    );
  }
}
