import { hasTable, type Tx } from "@/lib/db";

/**
 * Event feed de una orden/turno (taller v3): cada cambio relevante queda
 * registrado en `booking_events` y se muestra en la ficha de la orden.
 * Tolerante a migración sin aplicar (hasTable antes de tocar: un try/catch
 * ciego envenena la tx con 25P02). Nunca lanza: el feed es best-effort.
 */
export type BookingEventKind =
  | "created"
  | "status"
  | "diagnosis"
  | "quote_linked"
  | "quote_sent"
  | "quote_approved"
  | "parts"
  | "payment"
  | "signature"
  | "extended"
  | "note";

export async function addBookingEventTx(
  tx: Tx,
  input: {
    vendorId: string;
    bookingId: string;
    kind: BookingEventKind;
    message: string;
    actor?: string | null;
  }
): Promise<void> {
  if (!input.vendorId || !input.bookingId) return;
  const message = String(input.message || "").trim().slice(0, 300);
  if (!message) return;
  if (!(await hasTable(tx, "booking_events"))) return;
  await tx.queryVoid(
    `INSERT INTO booking_events (vendor_id, booking_id, kind, message, actor)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.vendorId, input.bookingId, input.kind, message, input.actor || null]
  );
}
