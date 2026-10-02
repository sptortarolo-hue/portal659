import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, queryOne, withTransaction } from "@/lib/db";
import { DEFAULT_DURATION_MIN, occupancyEnd, windowsOverlap } from "@/lib/reservations";
import { NextResponse } from "next/server";

function migrationPending(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return /relation "?reservations"? does not exist|42P01|does not exist/i.test(msg);
}

export async function GET(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("mesas")) {
    return NextResponse.json(
      { error: "Las reservas forman parte del plan Gestión integral" },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "pendiente";
  const allowed = ["pendiente", "sentada", "cancelada"];
  if (!allowed.includes(status)) {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }

  try {
    const reservations = await queryMany<Record<string, unknown>>(
      `SELECT r.*, t.name AS table_name
       FROM reservations r
       LEFT JOIN tables t ON t.id = r.table_id
       WHERE r.vendor_id = $1 AND r.status = $2
       ORDER BY r.reserved_at ASC LIMIT 100`,
      [gate.vendor.id, status]
    );
    // Ventana configurable del comercio (defaults si falta la migración).
    let config = { lead_min: 15, tolerance_min: 15 };
    try {
      const v = await queryOne<{ lead_min: number | null; tolerance_min: number | null }>(
        `SELECT reservation_lead_min AS lead_min, reservation_tolerance_min AS tolerance_min
         FROM vendors WHERE id = $1 LIMIT 1`,
        [gate.vendor.id]
      );
      if (v) {
        config = {
          lead_min: v.lead_min ?? 15,
          tolerance_min: v.tolerance_min ?? 15,
        };
      }
    } catch { /* columnas sin migrar: defaults */ }
    return NextResponse.json({ reservations: reservations || [], config });
  } catch (e) {
    if (migrationPending(e)) {
      return NextResponse.json(
        { error: "Falta aplicar la migración migrate-table-reservations.sql", code: "migration_pending" },
        { status: 503 }
      );
    }
    throw e;
  }
}

export async function POST(request: Request) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("mesas")) {
    return NextResponse.json(
      { error: "Las reservas forman parte del plan Gestión integral" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { tableId, customer_name, customer_phone, customer_email, party_size, reserved_at, duration_min, notes } = body;

  if (!tableId) return NextResponse.json({ error: "Falta la mesa" }, { status: 400 });
  const name = String(customer_name || "").trim();
  const phone = String(customer_phone || "").trim();
  if (!name) return NextResponse.json({ error: "Falta el nombre del cliente" }, { status: 400 });
  if (!phone) return NextResponse.json({ error: "Falta el teléfono del cliente" }, { status: 400 });
  const when = new Date(String(reserved_at || ""));
  if (Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: "Fecha y hora inválidas" }, { status: 400 });
  }
  const party = Math.max(1, Math.min(30, Math.round(Number(party_size) || 2)));
  const duration = Math.max(15, Math.min(720, Math.round(Number(duration_min) || DEFAULT_DURATION_MIN)));
  const newStart = when.getTime();
  const newEnd = occupancyEnd(newStart, duration);

  try {
    const out = await withTransaction(async (tx) => {
      const table = await tx.queryOne<{ id: string }>(
        `SELECT id FROM tables WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [tableId, gate.vendor.id]
      );
      if (!table) return { ok: false as const, status: 404, error: "Mesa no encontrada" };
      // La reserva ya no exige mesa libre ni la bloquea al crear: el bloqueo
      // es por ventana de turno. Solo se rechazan solapes con otras pendientes.
      const pending = await tx.query<{ reserved_at: string; duration_min: number | null; customer_name: string }>(
        `SELECT reserved_at, duration_min, customer_name FROM reservations
         WHERE vendor_id = $1 AND table_id = $2 AND status = 'pendiente'`,
        [gate.vendor.id, table.id]
      );
      for (const r of pending || []) {
        const s = new Date(r.reserved_at).getTime();
        if (Number.isNaN(s)) continue;
        if (windowsOverlap(s, occupancyEnd(s, r.duration_min), newStart, newEnd)) {
          return {
            ok: false as const,
            status: 409,
            error: `Se solapa con la reserva de ${r.customer_name} en esa mesa`,
          };
        }
      }
      const reservation = await tx.queryOne<Record<string, unknown>>(
        `INSERT INTO reservations (vendor_id, table_id, customer_name, customer_phone, customer_email, party_size, reserved_at, duration_min, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pendiente', $9) RETURNING *`,
        [
          gate.vendor.id,
          table.id,
          name,
          phone,
          String(customer_email || "").trim() || null,
          party,
          when.toISOString(),
          duration,
          String(notes || "").trim() || null,
        ]
      );
      return { ok: true as const, reservation };
    });

    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status });
    return NextResponse.json({ reservation: out.reservation });
  } catch (e) {
    if (migrationPending(e)) {
      return NextResponse.json(
        { error: "Falta aplicar la migración migrate-table-reservations.sql", code: "migration_pending" },
        { status: 503 }
      );
    }
    throw e;
  }
}
