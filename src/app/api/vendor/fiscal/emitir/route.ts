import { getVendorByRequest } from "@/lib/vendor-utils";
import { emitFiscalForOrder } from "@/lib/arca/emit-for-order";
import { NextResponse } from "next/server";

/**
 * Emite la Factura C de un pedido cobrado (toggle "con comprobante fiscal")
 * o de un turno atendido (cobro de servicio). Idempotente por referencia.
 * La lógica vive en `emitFiscalForOrder` para que el webhook de MP y el
 * polling del QR de mostrador puedan emitir sin Request.
 */
export async function POST(request: Request) {
  const { vendor: gateVendor, staffRole: gateStaff } = await getVendorByRequest(request);
  if (gateStaff === "delivery" || gateStaff === "staff") {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  if (!gateVendor) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const orderId = body.orderId ? String(body.orderId) : undefined;
  const bookingId = body.bookingId ? String(body.bookingId) : undefined;
  const orderIds = Array.isArray(body.orderIds) ? body.orderIds : undefined;
  if (!orderId && !bookingId && !orderIds?.length) {
    return NextResponse.json({ error: "orderId o bookingId requerido" }, { status: 400 });
  }

  const r = await emitFiscalForOrder({
    vendorId: gateVendor.id,
    orderId,
    orderIds: orderIds as string[] | undefined,
    bookingId,
    receptorDocTipo: body.receptorDocTipo,
    receptorDocNro: body.receptorDocNro,
    receptorCondIva: body.receptorCondIva,
    receptorNombre: body.receptorNombre,
  });

  if (r.ok) {
    return NextResponse.json({
      ok: true,
      invoice: r.invoice,
      qr_url: r.qrUrl,
      recovered: r.recovered,
    });
  }

  const detail = {
    ...(r.hint ? { hint: r.hint } : {}),
    ...(r.detail ? { detail: r.detail } : {}),
    ...(r.code ? { code: r.code } : {}),
  };
  switch (r.skipped) {
    case "plan":
      return NextResponse.json(
        { error: "Facturación electrónica exclusiva del plan Gestión integral", code: "plan_limit" },
        { status: 403 }
      );
    case "auto_disabled":
      return NextResponse.json({ error: "Emisión automática desactivada" }, { status: 403 });
    case "not_found":
      return NextResponse.json({ error: "Pedido o turno no encontrado" }, { status: 404 });
    case "cancelled":
      return NextResponse.json(
        { error: "No se puede facturar un pedido o turno cancelado" },
        { status: 400 }
      );
    case "preview":
      return NextResponse.json(
        { error: "Los pedidos de prueba no se facturan" },
        { status: 400 }
      );
    case "invalid_total":
      return NextResponse.json({ error: "Total inválido para facturar" }, { status: 400 });
  }
  if (r.error) {
    return NextResponse.json({ error: r.error, ...detail }, { status: r.status || 502 });
  }
  return NextResponse.json({ error: "No se pudo facturar" }, { status: 502 });
}
