import { getVendorByRequest } from "@/lib/vendor-utils";
import { notifyServiceClient } from "@/lib/service-notify";
import { addServiceJob, decrementCustomerFromOrder } from "@/lib/customers";
import { queryOne, query, withTransaction } from "@/lib/db";
import { NextResponse } from "next/server";

const VALID_STATUS = ["pending", "confirmed", "cancelled", "noshow"];

function todayAR(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const { id } = await params;
  const body = await request.json();

  const existing = await queryOne<{
    id: string;
    vendor_id: string;
    status: string;
    booking_date: string;
    customer_name: string | null;
    customer_phone: string | null;
  }>(
    `SELECT id, vendor_id, status, booking_date::text AS booking_date, customer_name, customer_phone
     FROM bookings WHERE id = $1 LIMIT 1`,
    [id]
  );

  if (!existing) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  if (existing.vendor_id !== vendor.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const status = String(body.status || "");
  if (!VALID_STATUS.includes(status)) {
    return NextResponse.json({ error: "Estado inválido" }, { status: 400 });
  }
  // Ausente solo si la fecha ya pasó (regla Fresha).
  if (status === "noshow" && existing.booking_date > todayAR()) {
    return NextResponse.json({ error: "Solo se puede marcar ausente un turno pasado" }, { status: 400 });
  }

  // Libro del cliente: confirmar un turno ya pasado suma el trabajo; cancelar
  // o marcar ausente un turno contado lo resta. Futuros no cuentan todavía.
  const wasCounted =
    existing.status === "confirmed" && existing.booking_date <= todayAR();
  const willCount = status === "confirmed" && existing.booking_date <= todayAR();

  try {
    await withTransaction(async (tx) => {
      await tx.queryVoid(`UPDATE bookings SET status = $1 WHERE id = $2`, [status, id]);
      if (willCount && !wasCounted) {
        await addServiceJob(tx, vendor.id, {
          phone: existing.customer_phone || "",
          name: existing.customer_phone ? existing.customer_name : null,
        });
      } else if (!willCount && wasCounted && (status === "cancelled" || status === "noshow")) {
        await decrementCustomerFromOrder(tx, vendor.id, {
          phone: existing.customer_phone || "",
        });
      }
    });
  } catch (e) {
    // Columna status sin 'noshow' (migración pendiente).
    if (status === "noshow" && /check|constraint|noshow|status/i.test((e as Error)?.message || "")) {
      return NextResponse.json(
        { error: "Falta aplicar la migración migrate-service-manual.sql en la base" },
        { status: 400 }
      );
    }
    throw e;
  }

  const booking = await queryOne<Record<string, unknown>>(
    `SELECT * FROM bookings WHERE id = $1 LIMIT 1`,
    [id]
  );

  // Aviso al cliente (push si tiene cuenta con ese teléfono; si no, el vendor
  // usa el link de WhatsApp de la agenda). Best-effort, no bloquea.
  if (status === "confirmed" || status === "cancelled") {
    const phone = booking?.customer_phone as string | undefined;
    const when = `${booking?.booking_date || ""} ${booking?.booking_time || ""}`.trim();
    await notifyServiceClient(phone, {
      title: status === "confirmed" ? "Turno confirmado ✅" : "Turno cancelado",
      body:
        status === "confirmed"
          ? `Tu turno${when ? ` del ${when}` : ""} fue confirmado.`
          : `Tu turno${when ? ` del ${when}` : ""} fue cancelado. Escribinos por WhatsApp para reprogramar.`,
    });
  }

  return NextResponse.json({ booking });
}
