import { gateRequest } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { validateDayRangesInput } from "@/lib/booking-schedule";
import { NextResponse } from "next/server";

/**
 * Ajustes de agenda por FECHA (modo "Agenda por semana"): abrir un día con
 * horas propias o cerrarlo. Solo `estetica`.
 * - GET /api/vendor/estetica-schedule-days?from=YYYY-MM-DD[&staffId=]
 * - POST { date, staff_id, ranges:[["09:00","13:00"]] } (upsert; [] = cerrado)
 * - DELETE ?id=  (o ?day=YYYY-MM-DD&staffId=)
 * Tolerante a migración sin aplicar (503 con mensaje claro).
 */
const MIGRATION = "Falta aplicar la migración migrate-estetica-schedule.sql en la base";

function checkEstetica(gate: { ok: boolean; vendor?: { vertical?: string } }) {
  if (!gate.ok || !gate.vendor) return null;
  if (gate.vendor.vertical !== "estetica") return "only-estetica";
  return "ok";
}

export async function GET(request: Request) {
  const gate: any = await gateRequest(request);
  if (!gate.ok) return NextResponse.json({ days: [] });
  if (checkEstetica(gate) !== "ok") return NextResponse.json({ days: [] });
  const { searchParams } = new URL(request.url);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get("from") || "")
    ? searchParams.get("from")!
    : new Date().toISOString().slice(0, 10);
  const staffId = searchParams.get("staffId") || "";
  try {
    const params: unknown[] = [gate.vendor.id, from];
    let extra = "";
    if (staffId) {
      params.push(staffId);
      extra = ` AND d.staff_id = $${params.length}`;
    }
    const days = await queryMany<Record<string, unknown>>(
      `SELECT d.id::text AS id, d.staff_id::text AS staff_id, st.name AS staff_name,
              d.day::text AS day, d.ranges
       FROM staff_schedule_days d
       LEFT JOIN estetica_staff st ON st.id = d.staff_id
       WHERE d.vendor_id = $1 AND d.day >= $2::date${extra}
       ORDER BY d.day ASC LIMIT 120`,
      params
    );
    return NextResponse.json({ days: days || [] });
  } catch {
    return NextResponse.json({ days: [], migrationMissing: true }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const gate: any = await gateRequest(request);
  if (!gate.ok) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (checkEstetica(gate) !== "ok") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const date = String(body.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
  }
  const staffId = typeof body.staff_id === "string" && body.staff_id ? body.staff_id : "";
  if (!staffId) return NextResponse.json({ error: "Elegí un profesional" }, { status: 400 });
  const v = validateDayRangesInput(body.ranges);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  try {
    const st = await queryOne<{ id: string }>(
      `SELECT id FROM estetica_staff WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
      [staffId, gate.vendor.id]
    );
    if (!st) return NextResponse.json({ error: "Profesional no encontrado" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: MIGRATION }, { status: 503 });
  }
  try {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO staff_schedule_days (vendor_id, staff_id, day, ranges)
       VALUES ($1, $2, $3::date, $4::jsonb)
       ON CONFLICT (vendor_id, staff_id, day)
       DO UPDATE SET ranges = EXCLUDED.ranges
       RETURNING id::text AS id`,
      [gate.vendor.id, staffId, date, JSON.stringify(v.value)]
    );
    return NextResponse.json({ ok: true, id: row?.id || null });
  } catch {
    return NextResponse.json({ error: MIGRATION }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const gate: any = await gateRequest(request);
  if (!gate.ok) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  if (checkEstetica(gate) !== "ok") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id") || "";
  const day = searchParams.get("day") || "";
  const staffId = searchParams.get("staffId") || "";
  try {
    if (id) {
      await queryOne(`DELETE FROM staff_schedule_days WHERE id = $1 AND vendor_id = $2`, [id, gate.vendor.id]);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(day) && staffId) {
      await queryOne(
        `DELETE FROM staff_schedule_days WHERE vendor_id = $1 AND staff_id = $2 AND day = $3::date`,
        [gate.vendor.id, staffId, day]
      );
    } else {
      return NextResponse.json({ error: "Falta id o day+staffId" }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: MIGRATION }, { status: 503 });
  }
}
