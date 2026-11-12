import { NextResponse } from "next/server";
import { getVendorByRequest } from "@/lib/vendor-utils";
import { queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { resolveEffectiveAccount } from "@/lib/bank-accounts-server";

/**
 * POST /api/vendor/orders/[id]/send-payment-data — el comercio aprieta el botón
 * "Enviar datos de pago por WA" en el pedido (transferencia pendiente) y el bot
 * manda el alias/CBU/titular + monto + link de seguimiento por WhatsApp. El
 * comprobante del cliente vuelve por el mismo chat → transfer_proof_url →
 * visible en el panel. Manual a propósito: el comercio decide cuándo cobrar.
 *
 * Body opcional: { bankAccountId } — la cuenta a la que entra la transferencia.
 * Si se manda (o ya había una guardada en el pedido), los reenvíos usan la
 * misma cuenta; si no hay ninguna, se usa la principal (o el espejo legacy).
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const params = await context.params;
  const { vendor } = await getVendorByRequest(request);
  if (!vendor) return NextResponse.json({ error: "No autorizado" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const preferredId = typeof body?.bankAccountId === "string" ? body.bankAccountId : null;

  const order = await queryOne<{
    id: string;
    customer_phone: string | null;
    total: number;
    payment_method: string;
    payment_status: string;
    pickup_number: number | null;
    track_token: string | null;
    bank_account_id: string | null;
  }>(
    `SELECT id, customer_phone, total, payment_method, payment_status, pickup_number, track_token,
            bank_account_id
     FROM orders WHERE id = $1 AND vendor_id = $2 LIMIT 1`,
    [params.id, vendor.id]
  );
  if (!order) return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  if (order.payment_method !== "transferencia") {
    return NextResponse.json({ error: "El pedido no es por transferencia" }, { status: 400 });
  }
  if (!order.customer_phone || order.customer_phone.startsWith("lid:")) {
    return NextResponse.json({ error: "El pedido no tiene teléfono del cliente" }, { status: 400 });
  }
  if (order.payment_status === "paid") {
    return NextResponse.json({ error: "El pedido ya está pagado" }, { status: 400 });
  }

  // Cuenta efectiva: la elegida → la guardada en el pedido → la principal →
  // el espejo legacy. Se persiste en el pedido para que los reenvíos (y el
  // WA automático del pedido pesado) usen la misma cuenta.
  const chosenId = preferredId || order.bank_account_id;
  const resolved = await resolveEffectiveAccount(vendor.id, chosenId);
  const acc = resolved.account;
  const legacy = resolved.legacy;

  const alias = acc?.alias ?? legacy?.alias ?? null;
  const cbu = acc?.cbu ?? legacy?.cbu ?? null;
  const holder = acc?.holder ?? legacy?.holder ?? null;
  const accountIdToStore = acc?.id ?? order.bank_account_id ?? null;

  // Persistir la cuenta elegida (tolerante a migración sin columna).
  if (accountIdToStore && accountIdToStore !== order.bank_account_id) {
    try {
      await queryOne(
        `UPDATE orders SET bank_account_id = $1 WHERE id = $2 AND vendor_id = $3`,
        [accountIdToStore, params.id, vendor.id]
      );
    } catch {
      /* columna sin migrar: se ignora */
    }
  }

  const nro = order.pickup_number != null ? `Nro. ${order.pickup_number}` : `#${order.id.slice(0, 8)}`;
  const lines = [`✅ ¡Tu pedido ${nro} fue aceptado!`, "", "Para el pago (transferencia):"];
  if (alias) lines.push(`Alias: ${alias}`);
  if (cbu) lines.push(`CBU: ${cbu}`);
  if (holder) lines.push(`Titular: ${holder}`);
  lines.push(`Monto: $${Number(order.total).toLocaleString("es-AR")}`);
  lines.push("", "Mandanos la foto o el PDF del comprobante por acá y lo verificamos enseguida. 🙏");
  // Sin link de seguimiento acá: el tracking solo va en los mensajes de
  // aceptación y "en camino" — los otros eventos no la repiten.

  const wabotUrl = (process.env.WABOT_URL || "http://wabot:8792").replace(/\/$/, "");
  const r = await fetch(`${wabotUrl}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.WA_BOT_SECRET || ""}`,
    },
    body: JSON.stringify({
      vendorId: vendor.id,
      waId: order.customer_phone,
      text: lines.join("\n"),
      orderId: params.id,
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r) return NextResponse.json({ error: "El bot no está conectado (el celular está apagado o sin señal)" }, { status: 502 });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json({ error: data.error || "No se pudo enviar" }, { status: 502 });
  return NextResponse.json({ ok: true, sent: data.sent === true, reason: data.reason || null, bankAccountId: accountIdToStore, alias, cbu, holder });
}
