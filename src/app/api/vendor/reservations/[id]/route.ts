import { gateRequest, gateError } from "@/lib/subscription-gate";
import { withTransaction } from "@/lib/db";
import { NextResponse } from "next/server";

function migrationPending(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return /relation "?reservations"? does not exist|42P01/i.test(msg);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) return gateError(gate);
  if (!gate.plan.can("mesas")) {
    return NextResponse.json(
      { error: "Las reservas forman parte del plan Gestión integral" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const action = String(body?.action || "");
  if (!["seat", "cancel", "absent"].includes(action)) {
    return NextResponse.json({ error: "Acción inválida (seat | cancel | absent)" }, { status: 400 });
  }

  try {
    const out = await withTransaction(async (tx) => {
      const reservation = await tx.queryOne<{ id: string; table_id: string | null; status: string }>(
        `SELECT id, table_id, status FROM reservations WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
        [id, gate.vendor.id]
      );
      if (!reservation) return { ok: false as const, status: 404, error: "Reserva no encontrada" };
      if (reservation.status !== "pendiente") {
        return { ok: false as const, status: 409, error: "La reserva ya fue gestionada" };
      }

      // El bloqueo es por ventana de turno (derivado), no por estado guardado:
      // sentar/cancelar/ausente no tocan tables salvo seat → ocupada.
      if (action === "seat") {
        // Como Fudo: si la mesa está ocupada con otra venta, no se pisa.
        if (reservation.table_id) {
          const table = await tx.queryOne<{ status: string }>(
            `SELECT status FROM tables WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
            [reservation.table_id, gate.vendor.id]
          );
          if (table?.status === "ocupada") {
            return { ok: false as const, status: 409, error: "La mesa está ocupada con otra venta" };
          }
        }
        await tx.queryVoid(`UPDATE reservations SET status = 'sentada' WHERE id = $1`, [id]);
        if (reservation.table_id) {
          await tx.queryVoid(
            `UPDATE tables SET status = 'ocupada' WHERE id = $1 AND vendor_id = $2`,
            [reservation.table_id, gate.vendor.id]
          );
        }
      } else if (action === "cancel") {
        await tx.queryVoid(`UPDATE reservations SET status = 'cancelada' WHERE id = $1`, [id]);
      } else {
        await tx.queryVoid(`UPDATE reservations SET status = 'ausente' WHERE id = $1`, [id]);
      }

      const updated = await tx.queryOne<Record<string, unknown>>(
        `SELECT r.*, t.name AS table_name
         FROM reservations r
         LEFT JOIN tables t ON t.id = r.table_id
         WHERE r.id = $1 LIMIT 1`,
        [id]
      );
      return { ok: true as const, reservation: updated ?? {} };
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
