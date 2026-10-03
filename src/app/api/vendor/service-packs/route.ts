import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

/**
 * Packs de sesiones del centro de estética (v1: depi definitiva, faciales).
 * Venta manual en el panel + contador de sesiones por teléfono.
 * Solo vertical `estetica`. Tolerante a migración sin aplicar.
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "estetica") return NextResponse.json({ packs: [] });
  try {
    const packs = await queryMany<Record<string, unknown>>(
      `SELECT * FROM service_packs WHERE vendor_id = $1 ORDER BY name ASC`,
      [gate.vendor.id]
    );
    return NextResponse.json({ packs: packs || [] });
  } catch {
    return NextResponse.json({ packs: [], migrationMissing: true }, { status: 503 });
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
  const sessions = Math.min(100, Math.max(1, Math.floor(Number(body.sessions_total) || 0)));
  if (!name || !sessions) {
    return NextResponse.json({ error: "Faltan nombre y cantidad de sesiones" }, { status: 400 });
  }
  const priceRaw = body.price;
  const price = priceRaw == null || priceRaw === "" ? null : Number(priceRaw);
  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    return NextResponse.json({ error: "El precio debe ser un monto válido" }, { status: 400 });
  }
  try {
    const pack = await queryOne<Record<string, unknown>>(
      `INSERT INTO service_packs (vendor_id, name, sessions_total, price, active)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [gate.vendor.id, name, sessions, price, body.active === false ? false : true]
    );
    return NextResponse.json({ pack });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica.sql en la base" },
      { status: 503 }
    );
  }
}
