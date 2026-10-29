import { gateRequest } from "@/lib/subscription-gate";
import { query, queryOne, withTransaction } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { isPreviewRow } from "@/lib/preview-flag";
import { notifyServiceClient } from "@/lib/service-notify";
import { isValidCuit } from "@/lib/arca/crypto";
import { normalizeReceptorFiscal } from "@/lib/arca/wsfe";
import { FiscalIssueError, issueFiscalInvoice } from "@/lib/arca/issue-invoice";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Cobra el saldo de un turno atendido (servicio / estética / oficios).
 * Cuerpo: { payment_method, amount_paid, wantFiscal?, receptorDocTipo?,
 *   receptorDocNro?, receptorCondIva?, receptorNombre? }
 *
 * - La seña ya pagada (deposit_status='paid') se descuenta del saldo.
 * - Efectivo: registra movimiento de caja (ingreso) para el cierre Z.
 * - wantFiscal + plan Gestión + fiscal configurado: emite Factura C ARCA
 *   vinculada al turno (booking_id en invoices).
 * - Fiado: queda como deuda, no se marca completado.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  if (!gate.plan.can("pos") && !gate.plan.can("deposits")) {
    return NextResponse.json(
      { error: "Cobrar turnos requiere el plan Gestión integral o Oficios", code: "plan_limit" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const paymentMethod = String(body.payment_method || "").trim();
  const amountPaid = Number(body.amount_paid);
  const wantFiscal = body.wantFiscal === true;
  // Precio final del servicio (servicios cobrados "desde"): lo define el
  // comercio al atender; actualiza el snapshot `service_price` del turno.
  const finalPriceRaw = body.final_price;
  const finalPrice =
    finalPriceRaw == null || finalPriceRaw === ""
      ? null
      : Math.round(Number(finalPriceRaw) * 100) / 100;
  if (finalPrice !== null && (!Number.isFinite(finalPrice) || finalPrice <= 0)) {
    return NextResponse.json({ error: "El precio final debe ser mayor a 0" }, { status: 400 });
  }

  const validMethods = ["efectivo", "transferencia", "tarjeta", "mixto", "whatsapp", "fiado"];
  if (!validMethods.includes(paymentMethod)) {
    return NextResponse.json({ error: "Medio de pago inválido" }, { status: 400 });
  }
  if (!(amountPaid > 0) && paymentMethod !== "fiado") {
    return NextResponse.json({ error: "El monto cobrado debe ser mayor a 0" }, { status: 400 });
  }

  const booking = await queryOne<{
    id: string;
    vendor_id: string;
    status: string | null;
    deposit_amount: number | null;
    deposit_status: string | null;
    service_price: number | null;
    customer_name: string | null;
    customer_phone: string | null;
    booking_date: string;
    booking_time: string;
    is_preview: boolean | null;
  }>(
    `SELECT id, vendor_id, status, deposit_amount, deposit_status, service_price::numeric AS service_price,
            customer_name, customer_phone, booking_date::text AS booking_date, booking_time::text AS booking_time,
            is_preview
     FROM bookings WHERE id = $1 LIMIT 1`,
    [id]
  ).catch(() => undefined);
  if (!booking) return NextResponse.json({ error: "Turno no encontrado" }, { status: 404 });
  if (booking.vendor_id !== gate.vendor.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  if (booking.is_preview === true) {
    return NextResponse.json({ error: "No se cobran turnos de prueba" }, { status: 400 });
  }
  if (booking.status === "completed") {
    return NextResponse.json({ error: "Este turno ya está atendido y cobrado" }, { status: 400 });
  }
  if (booking.status !== "confirmed") {
    return NextResponse.json({ error: "Solo se puede cobrar un turno confirmado" }, { status: 400 });
  }

  const total = finalPrice != null ? finalPrice : Math.round((Number(booking.service_price) || 0) * 100) / 100;
  const depositPaid = booking.deposit_status === "paid" ? Math.round((Number(booking.deposit_amount) || 0) * 100) / 100 : 0;
  const balance = Math.max(0, total - depositPaid);
  // La Factura C refleja lo realmente cobrado del servicio (seña + saldo del acto).
  const invoiceTotal = Math.round((depositPaid + amountPaid) * 100) / 100;

  if (paymentMethod === "fiado") {
    try {
      await withTransaction(async (tx) => {
        await tx.queryVoid(
          `UPDATE bookings SET payment_method = 'fiado', amount_paid = 0, payment_status = 'pending' WHERE id = $1 AND vendor_id = $2`,
          [id, gate.vendor.id]
        );
      });
    } catch {
      /* columnas de pago sin migrar: falla silencioso igual que el resto */
    }
    await notifyServiceClient(booking.customer_phone, {
      title: "Turno en deuda (fiado)",
      body: `Tu turno del ${booking.booking_date} a las ${String(booking.booking_time).slice(0, 5)} quedó como deuda pendiente. Te contactamos para el cobro.`,
    });
    return NextResponse.json({
      ok: true,
      payment_method: "fiado",
      amount_paid: 0,
      balance,
      message: "Quedó como deuda (fiado). Se cobrará en otra oportunidad.",
    });
  }

  if (amountPaid < balance) {
    return NextResponse.json(
      { error: `Monto insuficiente: el saldo es $${balance.toLocaleString("es-AR")} (seña descontada)`, code: "insufficient_amount" },
      { status: 400 }
    );
  }

  let invoice;
  if (wantFiscal) {
    if (!gate.plan.can("fiscal")) {
      return NextResponse.json(
        { error: "Factura C exclusiva del plan Gestión integral", code: "plan_limit" },
        { status: 403 }
      );
    }
    let receptor;
    try {
      receptor = normalizeReceptorFiscal(
        body.receptorDocTipo,
        body.receptorDocNro,
        body.receptorCondIva,
        isValidCuit
      );
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Receptor inválido" },
        { status: 400 }
      );
    }
    try {
      const issued = await issueFiscalInvoice({
        vendor: gate.vendor,
        total: invoiceTotal,
        orderId: null,
        bookingId: id,
        receptor,
        receptorNombre:
          typeof body.receptorNombre === "string" && body.receptorNombre.trim()
            ? body.receptorNombre.trim().slice(0, 120)
            : null,
      });
      invoice = issued.invoice;
    } catch (e) {
      if (e instanceof FiscalIssueError) {
        return NextResponse.json(
          { error: e.message, code: e.code, ...(e.hint ? { hint: e.hint } : {}), ...(e.detail ? { detail: e.detail.slice(0, 2000) } : {}) },
          { status: e.status }
        );
      }
      throw e;
    }
  }

  try {
    await withTransaction(async (tx) => {
      await tx.queryVoid(
        `UPDATE bookings
          SET status = 'completed', payment_status = 'paid', payment_method = $1, amount_paid = $2, paid_at = now(), completed_at = now()
         WHERE id = $3 AND vendor_id = $4 AND status <> 'completed'`,
        [paymentMethod, amountPaid, id, gate.vendor.id]
      );
      // Precio final ("desde"): el snapshot del turno pasa a ser lo realmente
      // cobrado (comisiones y analytics lo siguen). Tolerante si la columna
      // de comisiones no está migrada.
      if (finalPrice != null) {
        await tx.queryVoid(
          `UPDATE bookings SET service_price = $1 WHERE id = $2 AND vendor_id = $3`,
          [finalPrice, id, gate.vendor.id]
        ).catch(() => { /* sin columna: se ignora */ });
      }
      // El cobro del turno se registra en la Caja a través de `bookings.paid_at`
      // (computeCashClosing suma bookings por payment_method), igual que
      // gastronomía con `orders`. Antes se insertaba un `cash_movement`
      // manual de efectivo, lo que solo cubría ese medio y duplicaba el
      // esperado; ahora el efectivo entra por cashTotal y queda por medio.
    });
  } catch (e) {
    const emsg = (e as Error)?.message || "";
    if (/check|constraint|completed|status|payment/i.test(emsg)) {
      return NextResponse.json(
        { error: "Falta aplicar la migración migrate-estetica-booking-payment.sql en la base" },
        { status: 503 }
      );
    }
    throw e;
  }

  // Aviso al cliente (best-effort).
  await notifyServiceClient(booking.customer_phone, {
    title: "Turno atendido y cobrado ✅",
    body: `Gracias por visitarnos. Tu turno del ${booking.booking_date} a las ${String(booking.booking_time).slice(0, 5)} quedó atendido y cobrado.`,
  });

  const changed = await queryOne<{ status: string | null; payment_status: string | null }>(
    `SELECT status, payment_status FROM bookings WHERE id = $1 LIMIT 1`,
    [id]
  );
  return NextResponse.json({
    ok: true,
    booking: changed,
    total,
    deposit_paid: depositPaid,
    balance,
    amount_paid: amountPaid,
    payment_method: paymentMethod,
    invoice: invoice ?? null,
    message: invoice
      ? `Turno atendido y cobrado. Factura C emitida.`
      : "Turno atendido y cobrado ✅",
  });
}
