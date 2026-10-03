import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany } from "@/lib/db";
import { NextResponse } from "next/server";

/**
 * Reporte de comisiones por profesional (v1: solo reporte, sin split
 * automático de dinero). Suma turnos CONFIRMADOS en el rango (default: mes
 * en curso) con precio y % snapshot del momento de la reserva.
 * - GET /api/vendor/estetica-staff/report?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "estetica") {
    return NextResponse.json({ error: "Solo disponible para estética" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const iso = (s: string | null) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s! : null);
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const from = iso(searchParams.get("from")) || monthStart;
  const to = iso(searchParams.get("to")) || "2999-12-31";

  try {
    let rows;
    try {
      // Snapshot (migrate-estetica-commissions.sql).
      rows = await queryMany<{
        staff_id: string | null;
        staff_name: string | null;
        turnos: number;
        total: number;
        comision: number;
      }>(
        `SELECT b.staff_id::text AS staff_id, st.name AS staff_name,
                COUNT(*)::int AS turnos,
                COALESCE(SUM(b.service_price), 0)::float AS total,
                COALESCE(SUM(b.service_price * COALESCE(b.commission_pct, 0) / 100), 0)::float AS comision
         FROM bookings b
         LEFT JOIN estetica_staff st ON st.id = b.staff_id
         WHERE b.vendor_id = $1 AND b.status = 'confirmed'
           AND b.booking_date >= $2 AND b.booking_date <= $3
         GROUP BY b.staff_id, st.name
         ORDER BY comision DESC`,
        [gate.vendor.id, from, to]
      );
    } catch {
      // Sin snapshot: precio/% vigentes del catálogo.
      rows = await queryMany<{
        staff_id: string | null;
        staff_name: string | null;
        turnos: number;
        total: number;
        comision: number;
      }>(
        `SELECT b.staff_id::text AS staff_id, st.name AS staff_name,
                COUNT(*)::int AS turnos,
                COALESCE(SUM(s.price), 0)::float AS total,
                COALESCE(SUM(s.price * COALESCE(s.commission_pct, st.commission_pct, 0) / 100), 0)::float AS comision
         FROM bookings b
         LEFT JOIN services s ON s.id = b.service_id
         LEFT JOIN estetica_staff st ON st.id = b.staff_id
         WHERE b.vendor_id = $1 AND b.status = 'confirmed'
           AND b.booking_date >= $2 AND b.booking_date <= $3
         GROUP BY b.staff_id, st.name
         ORDER BY comision DESC`,
        [gate.vendor.id, from, to]
      );
    }
    const list = (rows || []).map((r) => ({
      staffId: r.staff_id,
      staffName: r.staff_name || "Sin asignar",
      turnos: Number(r.turnos) || 0,
      total: Math.round(Number(r.total) || 0),
      comision: Math.round(Number(r.comision) || 0),
    }));
    const totals = {
      turnos: list.reduce((s, r) => s + r.turnos, 0),
      total: list.reduce((s, r) => s + r.total, 0),
      comision: list.reduce((s, r) => s + r.comision, 0),
    };
    return NextResponse.json({ from, to, rows: list, totals });
  } catch {
    return NextResponse.json(
      { error: "Falta aplicar la migración migrate-estetica.sql en la base" },
      { status: 503 }
    );
  }
}
