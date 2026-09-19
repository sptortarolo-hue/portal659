import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { toE164 } from "@/lib/phone";

/**
 * GET /api/orders/latest-token?vendor=<slug>&phone=<celular>
 *
 * El cliente vuelve de pagar con MP cuando el webhook quizá todavía no creó el
 * pedido: la página de retorno poll-ea este endpoint hasta que aparezca el
 * track_token del pedido (o se rinde a los ~60s y solo muestra confirmación).
 * Solapa mismo dato que ya es público en /seguimiento (token = acceso).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = (searchParams.get("vendor") || "").trim();
  const e164 = toE164(searchParams.get("phone") || "");
  if (!slug || !e164) {
    return NextResponse.json({ ok: false, error: "Parámetros inválidos" }, { status: 400 });
  }

  const row = await queryOne<{ token: string }>(
    `SELECT o.track_token AS token
     FROM orders o
     JOIN vendors v ON v.id = o.vendor_id
     WHERE v.slug = $1 AND o.customer_phone = $2 AND o.created_at > now() - interval '2 hours'
     ORDER BY o.created_at DESC
     LIMIT 1`,
    [slug, e164]
  );

  return NextResponse.json({ ok: true, token: row?.token ?? null });
}
