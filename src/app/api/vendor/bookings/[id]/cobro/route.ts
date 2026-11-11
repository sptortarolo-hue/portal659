import { gateRequest } from "@/lib/subscription-gate";
import { hasTable, query, queryOne, withTransaction, type Tx } from "@/lib/db";
import { addBookingEventTx } from "@/lib/booking-events";
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
 *   receptorDocNro?, receptorCondIva?, receptorNombre?,
 *   cuenta_items?: [{description, qty, unit_price}] }
 *
 * - La seña ya pagada (deposit_status='paid') se descuenta del saldo.
 * - Efectivo: registra movimiento de caja (ingreso) para el cierre Z.
 * - wantFiscal + plan Gestión + fiscal configurado: emite Factura C ARCA
 *   vinculada al turno (booking_id en invoices).
 * - cuenta_items: detalle de la cuenta cuando el turno NO tiene servicio ni
 *   orden asociada (se cobra "a mano"). Se guarda como partidas de la cuenta
 *   (work_order_parts, o texto en el feed si la tabla no existe) y define el
 *   total cuando el turno no tiene precio de servicio.
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

  // Detalle de la cuenta (turno sin servicio asociado): partidas libres que
  // definen el total y quedan guardadas como líneas de la cuenta. Solo para
  // turnos: una ORDEN ya tiene su ficha de repuestos + mano de obra.
  type CuentaItem = { description: string; qty: number; unitPrice: number };
  const rawItems = Array.isArray(body.cuenta_items) ? (body.cuenta_items as unknown[]) : [];
  if (rawItems.length > 20) {
    return NextResponse.json({ error: "El detalle admite hasta 20 líneas" }, { status: 400 });
  }
  const cuentaItems: CuentaItem[] = [];
  for (const raw of rawItems) {
    const it = (raw || {}) as Record<string, unknown>;
    const description = String(it.description ?? "").trim().slice(0, 100);
    const qty = Math.round((Number(it.qty) || 0) * 100) / 100;
    const unitPrice = Math.round((Number(it.unit_price) || 0) * 100) / 100;
    if (!description || qty <= 0 || unitPrice < 0) {
      return NextResponse.json({ error: "Revisá las líneas del detalle (descripción, cantidad y precio)" }, { status: 400 });
    }
    cuentaItems.push({ description, qty, unitPrice });
  }
  const cuentaTotal =
    cuentaItems.length > 0
      ? Math.round(cuentaItems.reduce((s, it) => s + it.qty * it.unitPrice, 0) * 100) / 100
      : 0;
  const cuentaText =
    cuentaItems.length > 0
      ? cuentaItems.map((it) => `${it.qty}x ${it.description} — $${(it.qty * it.unitPrice).toLocaleString("es-AR")}`).join("; ")
      : "";

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
    kind: string | null;
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
    `SELECT id, vendor_id, kind, status, deposit_amount, deposit_status, service_price::numeric AS service_price,
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
  const isOrder = booking.kind === "orden";
  // Las órdenes ya tienen su propio detalle (repuestos + mano de obra en la
  // ficha): no se acepta el detalle libre para no duplicar partidas.
  if (isOrder && cuentaItems.length > 0) {
    return NextResponse.json(
      { error: "Esta es una orden de servicio: el detalle se carga desde su ficha (Repuestos y mano de obra)" },
      { status: 409 }
    );
  }
  // Órdenes: se cobra desde cualquier estado previo a entregar (recibida,
  // diagnosticada, presupuestada, aprobada, en reparación, esperando repuesto,
  // lista o turno confirmado). Turnos: solo desde "confirmed".
  const cobrable = isOrder
    ? ["pending", "diagnosed", "quoted", "approved", "repairing", "waiting_parts", "ready", "confirmed"].includes(booking.status || "")
    : booking.status === "confirmed";
  if (!cobrable) {
    return NextResponse.json({ error: isOrder ? "Solo se puede cobrar una orden en curso" : "Solo se puede cobrar un turno confirmado" }, { status: 400 });
  }

  // Total: el precio final enviado (servicio "desde"), el precio del servicio,
  // o la suma del detalle de la cuenta (turno sin servicio).
  const servicePrice = Math.round((Number(booking.service_price) || 0) * 100) / 100;
  const total = finalPrice != null
    ? finalPrice
    : servicePrice > 0
      ? servicePrice
      : cuentaTotal;
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
      // Precio final ("desde") y detalle de la cuenta (turno sin servicio):
      // el snapshot del turno pasa a ser lo realmente cobrado (comisiones y
      // analytics lo siguen). Tolerante si la columna no está migrada.
      const priceToStore = finalPrice != null
        ? finalPrice
        : servicePrice > 0
          ? null
          : cuentaTotal > 0
            ? cuentaTotal
            : null;
      if (priceToStore != null) {
        await tx.queryVoid(
          `UPDATE bookings SET service_price = $1 WHERE id = $2 AND vendor_id = $3`,
          [priceToStore, id, gate.vendor.id]
        ).catch(() => { /* sin columna: se ignora */ });
      }
      // Partidas de la cuenta (turno sin servicio): mismas filas que usa la
      // ficha de la orden (work_order_parts), con product_id nulo (no
      // descuentan stock). Tolerante a migrate-taller-v3.sql sin aplicar.
      if (cuentaItems.length > 0) {
        const hasParts = await hasTable(tx, "work_order_parts").catch(() => false);
        if (hasParts) {
          for (const it of cuentaItems) {
            await tx.queryVoid(
              `INSERT INTO work_order_parts (vendor_id, booking_id, name, qty, unit_cost, unit_price, created_by)
               VALUES ($1, $2, $3, $4, 0, $5, $6)`,
              [
                gate.vendor.id,
                id,
                it.description,
                it.qty,
                it.unitPrice,
                (gate.vendor as { user_id?: string }).user_id || null,
              ]
            ).catch(() => { /* columna faltante: el detalle queda en el feed */ });
          }
        }
      }
      // Event feed (taller v3): el cobro queda en la actividad. Si no se
      // pudieron guardar las partidas, el detalle viaja en el mensaje.
      await addBookingEventTx(tx, {
        vendorId: gate.vendor.id,
        bookingId: id,
        kind: "payment",
        message: cuentaText
          ? `Cobrado $${Number(amountPaid).toLocaleString("es-AR")} · ${paymentMethod} — ${cuentaText}`
          : `Cobrado $${Number(amountPaid).toLocaleString("es-AR")} · ${paymentMethod}`,
        actor: (gate.vendor as { user_id?: string }).user_id || null,
      });
      // Si la orden tiene un presupuesto vinculado, marcarlo como cobrado.
      const bq = await tx.queryOne<{ quote_id: string | null }>(
        `SELECT quote_id FROM bookings WHERE id = $1 LIMIT 1`,
        [id]
      ).catch(() => null);
      if (bq?.quote_id) {
        await tx.queryVoid(
          `UPDATE quotes SET status = 'cobrado', accepted_at = COALESCE(accepted_at, now()) WHERE id = $1`,
          [bq.quote_id]
        ).catch(() => { /* sin migración: se ignora */ });
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
