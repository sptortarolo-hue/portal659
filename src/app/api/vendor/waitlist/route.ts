import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne } from "@/lib/db";
import { NextResponse } from "next/server";

/**
 * Lista de espera del comercio (estética + servicios).
 * - GET ?date=YYYY-MM-DD (opcional): en espera, con servicio/staff.
 * - DELETE /[id]: quitar (ya atendida o vencida).
 * Convertir a turno: el panel precarga el modal manual (rebook).
 */
export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (gate.vendor.vertical !== "estetica" && gate.vendor.vertical !== "servicio") {
    return NextResponse.json({ waiting: [] });
  }
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") || "";
  try {
    const params: unknown[] = [gate.vendor.id];
    let extra = "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      params.push(date);
      extra = "AND w.booking_date = $2";
    }
    const rows = await queryMany<Record<string, unknown>>(
      `SELECT w.*, s.name AS service_label, st.name AS staff_label
       FROM waitlist w
       LEFT JOIN services s ON s.id = w.service_id
       LEFT JOIN estetica_staff st ON st.id = w.staff_id
       WHERE w.vendor_id = $1 ${extra}
       ORDER BY w.booking_date ASC, w.created_at ASC LIMIT 100`,
      params
    );
    return NextResponse.json({ waiting: rows || [] });
  } catch {
    return NextResponse.json({ waiting: [], migrationMissing: true }, { status: 503 });
  }
}
