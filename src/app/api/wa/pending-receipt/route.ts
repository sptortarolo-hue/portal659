import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { authWaBot } from "@/lib/wa-bot";

/**
 * GET /api/wa/pending-receipt?vendorId=&phone= — el pedido de transferencia
 * pendiente más reciente de ese teléfono (sin comprobante, últimas 48h).
 * Lo usa el cerebro del bot como FALLBACK: si el cliente manda el comprobante
 * cuando el chat ya no está en espera (llegó tarde, escribió antes, o el
 * estado se perdió), el comprobante se maneja igual por teléfono.
 * Tolerante a migración (transfer_proof_url sin columna → 404).
 */
export async function GET(request: Request) {
  if (!authWaBot(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }

  const url = new URL(request.url);
  const vendorId = url.searchParams.get("vendorId") || "";
  const phoneRaw = url.searchParams.get("phone") || "";
  const phoneDigits = phoneRaw.replace(/\D/g, "");

  if (!vendorId || !phoneDigits) {
    return NextResponse.json({ error: "vendorId y phone requeridos" }, { status: 400 });
  }

  try {
    const order = await queryOne<{ id: string; track_token: string | null }>(
      `SELECT id, track_token FROM orders
       WHERE vendor_id = $1
         AND payment_method = 'transferencia'
         AND payment_status = 'pending'
         AND transfer_proof_url IS NULL
         AND is_preview IS NOT TRUE
         AND status NOT IN ('cancelled', 'completed')
         AND created_at > now() - interval '48 hours'
         AND regexp_replace(customer_phone, '[^0-9]', '', 'g') = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [vendorId, phoneDigits]
    );
    if (!order) return NextResponse.json({ error: "Sin pedido pendiente" }, { status: 404 });
    return NextResponse.json({ orderId: order.id, trackToken: order.track_token });
  } catch {
    // Tabla sin migrar (transfer_proof_url no existe) → el fallback no aplica.
    return NextResponse.json({ error: "Sin pedido pendiente" }, { status: 404 });
  }
}