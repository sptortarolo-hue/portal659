import { NextResponse } from "next/server";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne } from "@/lib/db";
import { sendOrLink } from "@/lib/wa-dispatch";

/**
 * POST /api/vendor/orders/[id]/send-wa — envía un mensaje por WhatsApp al
 * cliente del pedido. Si el bot está conectado → automático (sendOrLink auto);
 * si no → devuelve { mode: "manual", url } con el link wa.me para abrir a mano.
 * Body: { text: string }.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const text = String(body?.text || "").trim();
  if (!text) return NextResponse.json({ error: "text requerido" }, { status: 400 });

  const order = await queryOne<{ customer_phone: string | null }>(
    `SELECT customer_phone FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [id, vendor.id]
  );
  if (!order) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  if (!order.customer_phone || order.customer_phone.startsWith("lid:")) {
    return NextResponse.json({ error: "El pedido no tiene teléfono del cliente" }, { status: 400 });
  }

  const result = await sendOrLink({
    vendorId: vendor.id,
    phone: order.customer_phone,
    text,
  });
  return NextResponse.json(result);
}
