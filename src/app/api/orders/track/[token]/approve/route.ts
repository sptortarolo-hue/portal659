import { queryOne } from "@/lib/db";
import { NextResponse } from "next/server";
import { withRateLimit } from "@/lib/api-wrapper";

export const dynamic = "force-dynamic";

/**
 * Aprobación del total real (pesables, modo "confirmar").
 * El cliente toca "Aceptar total" en el seguimiento cuando el peso real difiere
 * del estimado más allá de la tolerancia del comercio; recién ahí se habilita
 * el pago con MP (payments valida weight_approved_at).
 * Tolerante a migración sin aplicar: sin columnas, aprueba y listo.
 */
export const POST = withRateLimit(
  async (_request: Request, context: { params: Promise<{ token: string }> }) => {
    const params = await context.params;
    const token = params?.token;
    if (!token) {
      return NextResponse.json({ error: "Token requerido" }, { status: 400 });
    }

    const order = await queryOne<{
      id: string;
      status: string;
      payment_status: string;
      total: number | null;
      weight_confirmed_at: string | null;
      weight_approved_at: string | null;
      weight_estimated_total: number | null;
      weight_tolerance_pct: number | null;
    }>(
      `SELECT o.id, o.status, o.payment_status, o.total,
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'weight_confirmed_at')
                THEN o.weight_confirmed_at ELSE NULL END AS weight_confirmed_at,
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'weight_approved_at')
                THEN o.weight_approved_at ELSE NULL END AS weight_approved_at,
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'weight_estimated_total')
                THEN o.weight_estimated_total ELSE NULL END AS weight_estimated_total,
              CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vendors' AND column_name = 'weight_tolerance_pct')
                THEN v.weight_tolerance_pct ELSE 20 END AS weight_tolerance_pct
       FROM orders o LEFT JOIN vendors v ON v.id = o.vendor_id
       WHERE o.track_token = $1
       LIMIT 1`,
      [token]
    );

    if (!order) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }
    if (order.status === "cancelled") {
      return NextResponse.json({ error: "El pedido fue cancelado" }, { status: 400 });
    }
    if (order.payment_status === "paid") {
      return NextResponse.json({ ok: true, approved: true, alreadyPaid: true });
    }
    if (!order.weight_confirmed_at) {
      return NextResponse.json({ error: "El comercio todavía no confirmó el peso" }, { status: 409 });
    }

    // Si la diferencia está dentro de la tolerancia no hace falta aprobar:
    // respondemos approved (el cliente puede pagar directo).
    const est = Number(order.weight_estimated_total) || 0;
    const real = Number(order.total) || 0;
    const tol = Number.isFinite(Number(order.weight_tolerance_pct)) && Number(order.weight_tolerance_pct) > 0
      ? Math.min(100, Math.floor(Number(order.weight_tolerance_pct)))
      : 20;
    const withinTolerance = est > 0 && Math.abs(real - est) / est <= tol / 100;
    if (withinTolerance || order.weight_approved_at) {
      return NextResponse.json({ ok: true, approved: true });
    }

    try {
      await queryOne(
        `UPDATE orders SET weight_approved_at = now() WHERE id = $1 AND weight_approved_at IS NULL`,
        [order.id]
      );
      return NextResponse.json({ ok: true, approved: true });
    } catch {
      // Sin migración: no hay columna donde persistir la aprobación; el cobro
      // tampoco la va a exigir (el payments chequea la misma columna).
      return NextResponse.json({ ok: true, approved: true });
    }
  },
  { maxRequests: 20 }
);
