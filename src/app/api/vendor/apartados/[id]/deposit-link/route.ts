import { gateRequest } from "@/lib/subscription-gate";
import { query, queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { getVendorMpToken, isMpEnabled, type VendorMpRow } from "@/lib/mp-oauth";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Genera el link de cobro de seña por Mercado Pago para un apartado.
 * La plata cae en la cuenta MP del comercio. El webhook
 * (rama portal659_apartado_) marca la seña como pagada.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  // Crear el apartado es gratis; el link de Mercado Pago requiere cobrar
  // online: plan Gestión integral en moda, feature `deposits` (Oficios) en
  // otros verticales.
  const isModa = gate.vendor.vertical === "moda";
  if (isModa ? !gate.plan.can("mp_payments") : !gate.plan.can("deposits")) {
    return NextResponse.json(
      { error: "El link de Mercado Pago para la seña es del plan Gestión integral." },
      { status: 403 }
    );
  }
  if (!isMpEnabled()) {
    return NextResponse.json(
      { error: "Los pagos online están deshabilitados por ahora" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const order = await queryOne<{
    id: string;
    vendor_id: string;
    customer_name: string;
    total: number;
    status: string;
    is_apartado: boolean | null;
    deposit_pct: number | null;
    deposit_status: string | null;
    remainder_paid_at: string | null;
  }>(
    `SELECT id, vendor_id, customer_name, total, status, is_apartado, deposit_pct, deposit_status, remainder_paid_at
     FROM orders WHERE id = $1 LIMIT 1`,
    [id]
  ).catch(() => undefined);
  if (!order) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (order.vendor_id !== gate.vendor.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  if (!order.is_apartado) {
    return NextResponse.json({ error: "No es un apartado." }, { status: 400 });
  }
  if (order.status === "cancelled" || order.status === "completed") {
    return NextResponse.json({ error: "El apartado ya está cerrado." }, { status: 400 });
  }
  if (order.remainder_paid_at) {
    return NextResponse.json({ error: "El apartado ya está pago en su totalidad." }, { status: 400 });
  }
  if (order.deposit_status === "paid") {
    return NextResponse.json({ error: "La seña ya está cobrada." }, { status: 400 });
  }
  const pct = Number(order.deposit_pct);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 99) {
    return NextResponse.json({ error: "El % de seña del apartado es inválido." }, { status: 400 });
  }
  const amount = Math.round(Number(order.total) * (pct / 100) * 100) / 100;
  if (!(amount > 0)) {
    return NextResponse.json({ error: "Monto de seña inválido." }, { status: 400 });
  }

  let vendorRow;
  try {
    vendorRow = await queryOne<
      { store_name: string; slug: string; deposit_default_pct: number | null } & VendorMpRow
    >(
      `SELECT id, store_name, slug, mp_user_id, mp_access_token, mp_refresh_token, mp_public_key, mp_expires_at, mp_connected_at, deposit_default_pct
       FROM vendors WHERE id = $1 LIMIT 1`,
      [gate.vendor.id]
    );
  } catch {
    // Columna deposit_default_pct aún no migrada.
    vendorRow = await queryOne<{ store_name: string; slug: string } & VendorMpRow>(
      `SELECT id, store_name, slug, mp_user_id, mp_access_token, mp_refresh_token, mp_public_key, mp_expires_at, mp_connected_at
       FROM vendors WHERE id = $1 LIMIT 1`,
      [gate.vendor.id]
    );
  }
  if (!vendorRow) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });

  const mpToken = await getVendorMpToken(vendorRow);
  if (!mpToken) {
    return NextResponse.json(
      { error: "Conectá tu Mercado Pago desde el panel para cobrar seña online", code: "vendor_not_connected" },
      { status: 409 }
    );
  }

  const externalReference = `portal659_apartado_${order.id}_${Date.now()}`;
  try {
    const preference = {
      items: [
        {
          title: `Seña ${pct}% apartado — ${vendorRow.store_name} (${order.customer_name})`,
          unit_price: amount,
          quantity: 1,
          currency_id: "ARS",
        },
      ],
      metadata: { vendor_id: gate.vendor.id, order_id: order.id, kind: "order_deposit" },
      external_reference: externalReference,
      back_urls: {
        success: `${getSiteUrl()}/tienda/${vendorRow.slug || gate.vendor.id}`,
        failure: `${getSiteUrl()}/tienda/${vendorRow.slug || gate.vendor.id}`,
        pending: `${getSiteUrl()}/tienda/${vendorRow.slug || gate.vendor.id}`,
      },
      auto_return: "approved",
      notification_url: `${getSiteUrl()}/api/webhooks/mercadopago`,
    };

    const res = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${mpToken}` },
      body: JSON.stringify(preference),
    });
    const data = await res.json();
    if (!data.id) {
      console.warn(`[MP apartado] FAIL status=${res.status} vendor=${gate.vendor.id} message=${data.message || data.error || "sin detalle"}`);
      return NextResponse.json({ error: data.message || "Error al crear preferencia" }, { status: 500 });
    }
    const isTest = mpToken.startsWith("TEST-");
    const initPoint = isTest && data.sandbox_init_point ? data.sandbox_init_point : data.init_point;

    await query(
      `UPDATE orders SET deposit_amount = $1, deposit_pct = $2, deposit_status = 'pending', mp_payment_id = NULL WHERE id = $3`,
      [amount, pct, order.id]
    ).catch(() => {
      throw new Error("Falta aplicar la migración migrate-apartado.sql en la base");
    });

    console.log(`[MP apartado] ok order=${order.id} vendor=${gate.vendor.id} amount=${amount} pct=${pct}`);
    return NextResponse.json({ initPoint, amount, pct, sandbox: isTest });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error de conexión con Mercado Pago";
    const status = msg.startsWith("Falta aplicar") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
