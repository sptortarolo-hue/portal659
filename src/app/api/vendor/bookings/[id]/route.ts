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
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

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
  const hasStatus = VALID_STATUS.includes(status);
  // Productos utilizados (estética): texto libre con los insumos aplicados.
  // Puede guardarse solo (sin cambiar estado) o junto al cambio de estado.
  const wantProducts = body?.products_used !== undefined;
  const productsUsed =
    body?.products_used != null && String(body.products_used).trim() !== ""
      ? String(body.products_used).trim().slice(0, 500)
      : null;
  if (!hasStatus && !wantProducts) {
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
      if (hasStatus) {
        await tx.queryVoid(`UPDATE bookings SET status = $1 WHERE id = $2`, [status, id]);
      }
      if (wantProducts) {
        try {
          await tx.queryVoid(`UPDATE bookings SET products_used = $1 WHERE id = $2`, [productsUsed, id]);
        } catch {
          throw new Error("Falta aplicar la migración migrate-estetica-products-used.sql en la base");
        }
      }
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
    const emsg = (e as Error)?.message || "";
    // Columna status sin 'noshow' (migración pendiente).
    if (status === "noshow" && /check|constraint|noshow|status/i.test(emsg)) {
      return NextResponse.json(
        { error: "Falta aplicar la migración migrate-service-manual.sql en la base" },
        { status: 400 }
      );
    }
    if (emsg.startsWith("Falta aplicar")) {
      return NextResponse.json({ error: emsg }, { status: 503 });
    }
    throw e;
  }

  const booking = await queryOne<Record<string, unknown>>(
    `SELECT * FROM bookings WHERE id = $1 LIMIT 1`,
    [id]
  );

  // Si se liberó un hueco con gente en espera, avisar el conteo para que el
  // comercio contacte (la lista vive en Turnos).
  let waitlistCount = 0;
  if (status === "cancelled" && existing) {
    try {
      const w = await queryOne<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM waitlist WHERE vendor_id = $1 AND booking_date = $2::date`,
        [vendor.id, existing.booking_date]
      ).catch(() => ({ c: 0 }));
      waitlistCount = w?.c || 0;
    } catch { /* sin tabla: 0 */ }
  }

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

  return NextResponse.json({ booking, waitlistCount });
}
