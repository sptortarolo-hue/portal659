import { gateRequest, gateError } from "@/lib/subscription-gate";
import { queryMany, withTransaction } from "@/lib/db";
import { NextResponse } from "next/server";

function migrationPending(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return /relation "?reservations"? does not exist|42P01/i.test(msg);
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
    return NextResponse.json({ reservations: reservations || [] });
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
  const { tableId, customer_name, customer_phone, customer_email, party_size, reserved_at, notes } = body;

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

  try {
    const out = await withTransaction(async (tx) => {
      const table = await tx.queryOne<{ id: string; status: string }>(
        `SELECT id, status FROM tables WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [tableId, gate.vendor.id]
      );
      if (!table) return { ok: false as const, status: 404, error: "Mesa no encontrada" };
      if (table.status !== "libre") {
        return { ok: false as const, status: 409, error: "La mesa ya no está libre" };
      }
      const reservation = await tx.queryOne<Record<string, unknown>>(
        `INSERT INTO reservations (vendor_id, table_id, customer_name, customer_phone, customer_email, party_size, reserved_at, status, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente', $8) RETURNING *`,
        [
          gate.vendor.id,
          table.id,
          name,
          phone,
          String(customer_email || "").trim() || null,
          party,
          when.toISOString(),
          String(notes || "").trim() || null,
        ]
      );
      await tx.queryVoid(`UPDATE tables SET status = 'reservada' WHERE id = $1`, [table.id]);
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
