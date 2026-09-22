import { getVendorByRequest } from "@/lib/vendor-utils";
import { notifyServiceClient } from "@/lib/service-notify";
import { queryOne, query } from "@/lib/db";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  const existing = await queryOne<{ id: string; vendor_id: string }>(
    `SELECT id, vendor_id FROM bookings WHERE id = $1 LIMIT 1`,
    [id]
  );

  if (!existing) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  if (existing.vendor_id !== vendor.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  await query(`UPDATE bookings SET status = $1 WHERE id = $2`, [body.status, id]);

  const booking = await queryOne<Record<string, unknown>>(
    `SELECT * FROM bookings WHERE id = $1 LIMIT 1`,
    [id]
  );

  // Aviso al cliente (push si tiene cuenta con ese teléfono; si no, el vendor
  // usa el link de WhatsApp de la agenda). Best-effort, no bloquea.
  if (body.status === "confirmed" || body.status === "cancelled") {
    const phone = booking?.customer_phone as string | undefined;
    const when = `${booking?.booking_date || ""} ${booking?.booking_time || ""}`.trim();
    await notifyServiceClient(phone, {
      title: body.status === "confirmed" ? "Turno confirmado ✅" : "Turno cancelado",
      body:
        body.status === "confirmed"
          ? `Tu turno${when ? ` del ${when}` : ""} fue confirmado.`
          : `Tu turno${when ? ` del ${when}` : ""} fue cancelado. Escribinos por WhatsApp para reprogramar.`,
    });
  }

  return NextResponse.json({ booking });
}