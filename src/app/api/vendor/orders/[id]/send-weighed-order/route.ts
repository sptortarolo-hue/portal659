import { NextResponse } from "next/server";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { sendWeighedOrder } from "@/lib/weighed-order-message";
import { withRateLimit } from "@/lib/api-wrapper";

/**
 * POST /api/vendor/orders/[id]/send-weighed-order — "📲 Enviar pedido pesado por
 * WhatsApp". Nació como el envío manual (el comercio controlaba el monto); hoy
 * el PATCH de pedidos lo manda AUTOMÁTICO al confirmar el peso, así que este
 * botón queda como REENVÍO manual (o como vía cuando el bot estaba caído).
 * Reenvía el detalle con los kilos reales, el total real y la acción de pago
 * según el método elegido en el checkout (efectivo: cuánto paga al recibir ·
 * transferencia: alias/CBU + monto exacto · MP: link al seguimiento · coordinar:
 * por el chat). Toda la lógica vive en `src/lib/weighed-order-message.ts`.
 */
export const POST = withRateLimit(
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const params = await context.params;
    const { vendor } = await getVendorByRequest(request);
    if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

    const res = await sendWeighedOrder({ vendorId: vendor.id, orderId: params.id });
    if (!res.ok) {
      const status =
        res.code === "not_found"
          ? 404
          : res.code === "not_ready" || res.code === "paid" || res.code === "no_phone" || res.code === "not_pending"
            ? 400
            : 502;
      return NextResponse.json({ error: res.error, text: res.text }, { status });
    }
    return NextResponse.json({
      ok: true,
      sent: res.sent === true,
      reason: res.reason || null,
      text: res.text,
    });
  },
  { maxRequests: 20 }
);
