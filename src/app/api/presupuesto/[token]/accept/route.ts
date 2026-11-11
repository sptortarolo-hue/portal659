import { sendPushToUser } from "@/lib/push";
import { addBookingEventTx } from "@/lib/booking-events";
import { queryOne, withTransaction, type Tx } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Aceptación pública del presupuesto por el link /presupuesto/[token].
 * Idempotente. Si el presupuesto está vinculado a una orden de taller en
 * "Presupuestada", la orden auto-avanza a "Aprobada" (regla: la aceptación
 * del cliente habilita la reparación) y se le avisa al comercio.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!/^[0-9a-f]{24,64}$/i.test(token)) {
    return NextResponse.json({ error: "Link inválido" }, { status: 404 });
  }

  const quote = await queryOne<{ id: string; status: string; booking_id: string | null; vendor_user: string | null }>(
    `SELECT q.id, q.status, q.booking_id, v.user_id AS vendor_user
     FROM quotes q JOIN vendors v ON v.id = q.vendor_id
     WHERE q.public_token = $1
     LIMIT 1`,
    [token]
  ).catch(() => null);

  if (!quote) return NextResponse.json({ error: "Presupuesto no encontrado" }, { status: 404 });

  if (quote.status === "cancelled") {
    return NextResponse.json({ error: "Este presupuesto fue cancelado. Consultá con el comercio." }, { status: 409 });
  }
  if (quote.status === "accepted" || quote.status === "cobrado") {
    return NextResponse.json({ ok: true, already: true });
  }
  if (quote.status !== "pending" && quote.status !== "responded") {
    return NextResponse.json({ error: "Este presupuesto no puede aceptarse" }, { status: 409 });
  }

  let orderAdvanced = false;
  await withTransaction(async (tx: Tx) => {
    const updated = await tx.query<{ id: string }>(
      `UPDATE quotes SET status = 'accepted', accepted_at = now()
       WHERE id = $1 AND status IN ('pending', 'responded') RETURNING id`,
      [quote.id]
    );
    if (updated.length === 0) return; // otro dispositivo lo aceptó antes: idempotente

    // Auto-avance de la orden vinculada: Presupuestada → Aprobada.
    if (quote.booking_id) {
      const booking = await tx.queryOne<{ status: string | null }>(
        `SELECT status FROM bookings WHERE id = $1 LIMIT 1`,
        [quote.booking_id]
      ).catch(() => null);
      if (booking && (booking.status === "quoted" || booking.status === "pending")) {
        const b = await tx.query<{ id: string }>(
          `UPDATE bookings SET status = 'approved' WHERE id = $1 AND status IN ('quoted', 'pending') RETURNING id`,
          [quote.booking_id]
        );
        orderAdvanced = b.length > 0;
        if (orderAdvanced) {
          const ownerRow = await tx.queryOne<{ vendor_id: string }>(`SELECT vendor_id FROM bookings WHERE id = $1`, [quote.booking_id]);
          await addBookingEventTx(tx, {
            vendorId: ownerRow?.vendor_id || "",
            bookingId: quote.booking_id,
            kind: "quote_approved",
            message: "El cliente aceptó el presupuesto por el link — orden Aprobada",
          });
        }
      }
    }
  });

  // Aviso al comercio (best-effort: nunca bloquea la aceptación).
  if (quote.vendor_user) {
    try {
      await sendPushToUser(quote.vendor_user, {
        title: "✅ Presupuesto aceptado",
        body: orderAdvanced
          ? "El cliente aceptó por el link. La orden pasó a Aprobada."
          : "El cliente aceptó el presupuesto por el link.",
        link: "/vendor/dashboard?tab=taller",
      });
    } catch {
      /* best-effort */
    }
  }

  return NextResponse.json({ ok: true, already: false, orderAdvanced });
}
