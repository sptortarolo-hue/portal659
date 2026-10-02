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
  if (!["seat", "cancel"].includes(action)) {
    return NextResponse.json({ error: "Acción inválida (seat | cancel)" }, { status: 400 });
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

      if (action === "seat") {
        await tx.queryVoid(`UPDATE reservations SET status = 'sentada' WHERE id = $1`, [id]);
        if (reservation.table_id) {
          await tx.queryVoid(
            `UPDATE tables SET status = 'ocupada' WHERE id = $1 AND vendor_id = $2`,
            [reservation.table_id, gate.vendor.id]
          );
        }
      } else {
        await tx.queryVoid(`UPDATE reservations SET status = 'cancelada' WHERE id = $1`, [id]);
        // La mesa vuelve a libre solo si no tiene otra reserva pendiente y
        // sigue marcada como reservada (si ya se operó, no se toca).
        if (reservation.table_id) {
          const other = await tx.queryOne<{ id: string }>(
            `SELECT id FROM reservations
             WHERE vendor_id = $1 AND table_id = $2 AND status = 'pendiente' AND id <> $3 LIMIT 1`,
            [gate.vendor.id, reservation.table_id, id]
          );
          if (!other) {
            await tx.queryVoid(
              `UPDATE tables SET status = 'libre' WHERE id = $1 AND vendor_id = $2 AND status = 'reservada'`,
              [reservation.table_id, gate.vendor.id]
            );
          }
        }
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
