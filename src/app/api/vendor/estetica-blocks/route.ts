import { gateRequest } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

/**
 * Días bloqueados de la agenda (feriados, vacaciones). Solo `estetica`.
 * - GET /api/vendor/estetica-blocks?from=YYYY-MM-DD → próximos bloqueos.
 * - POST { date, staff_id?, reason? } → crea (staff null = todo el centro).
 * - DELETE ?id= → elimina.
 * Tolerante a migración sin aplicar (503 con mensaje claro).
 */
function checkEstetica(gate: { ok: boolean; vendor?: { vertical?: string } }) {
  if (!gate.ok || !gate.vendor) return null;
  if (gate.vendor.vertical !== "estetica") return "only-estetica";
  return "ok";
}

export async function GET(request: Request) {
  const gate: any = await gateRequest(request);
  if (!gate.ok) return NextResponse.json({ blocks: [] });
  if (checkEstetica(gate) !== "ok") return NextResponse.json({ blocks: [] });
  const { searchParams } = new URL(request.url);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("from") || "")
    ? searchParams.get("from")!
    : new Date().toISOString().slice(0, 10);
  try {
    const blocks = await queryMany<Record<string, unknown>>(
      `SELECT b.id::text AS id, b.block_date::text AS date, b.staff_id::text AS staff_id,
              st.name AS staff_name, b.reason
       FROM estetica_blocks b
       LEFT JOIN estetica_staff st ON st.id = b.staff_id
       WHERE b.vendor_id = $1 AND b.block_date >= $2::date
       ORDER BY b.block_date ASC LIMIT 60`,
      [gate.vendor.id, from]
    );
    return NextResponse.json({ blocks: blocks || [] });
  } catch {
    return NextResponse.json({ blocks: [], migrationMissing: true }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const gate: any = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (checkEstetica(gate) !== "ok") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const date = String(body.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
  }
  let staffId: string | null =
    typeof body.staff_id === "string" && body.staff_id ? body.staff_id : null;
  if (staffId) {
    try {
      const st = await queryOne<{ id: string }>(
        `SELECT id FROM estetica_staff WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [staffId, gate.vendor.id]
      );
      if (!st) return NextResponse.json({ error: "Profesional no encontrado" }, { status: 404 });
    } catch {
      staffId = null;
    }
  }
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 120)
      : null;
  try {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO estetica_blocks (vendor_id, staff_id, block_date, reason)
       VALUES ($1, $2, $3::date, $4)
       ON CONFLICT DO NOTHING
       RETURNING id::text AS id`,
      [gate.vendor.id, staffId, date, reason]
    ).catch(() =>
      // Sin índice único (migración vieja): insert directo.
      queryOne<{ id: string }>(
        `INSERT INTO estetica_blocks (vendor_id, staff_id, block_date, reason)
         VALUES ($1, $2, $3::date, $4)
         RETURNING id::text AS id`,
        [gate.vendor.id, staffId, date, reason]
      )
    );
    return NextResponse.json({ ok: true, id: row?.id || null });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica-noshow-blocks.sql en la base" },
      { status: 503 }
    );
  }
}

export async function DELETE(request: Request) {
  const gate: any = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  if (checkEstetica(gate) !== "ok") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
  try {
    await queryOne(`DELETE FROM estetica_blocks WHERE id = $1 AND vendor_id = $2`, [
      id,
      gate.vendor.id,
    ]);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica-noshow-blocks.sql en la base" },
      { status: 503 }
    );
  }
}
