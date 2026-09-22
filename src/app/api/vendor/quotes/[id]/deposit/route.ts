import { gateRequest } from "@/lib/subscription-gate";
import { query, queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { getVendorMpToken, isMpEnabled, type VendorMpRow } from "@/lib/mp-oauth";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Genera el link de cobro de seña por Mercado Pago para un presupuesto
 * cotizado (plan Oficios). La plata cae en la cuenta MP del comercio.
 * El webhook marca la seña como pagada y acepta el presupuesto.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await gateRequest(request);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  if (!gate.plan.can("deposits")) {
    return NextResponse.json(
      { error: "Cobrar seña online requiere el plan Oficios." },
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
  const quote = await queryOne<{
    id: string;
    vendor_id: string;
    customer_name: string;
    quoted_price: number | null;
    status: string;
  }>(
    `SELECT id, vendor_id, customer_name, quoted_price, status FROM quotes WHERE id = $1 LIMIT 1`,
    [id]
  ).catch(() => undefined);
  if (!quote) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (quote.vendor_id !== gate.vendor.id) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  if (quote.quoted_price == null || !(Number(quote.quoted_price) > 0)) {
    return NextResponse.json(
      { error: "Primero cotizá el presupuesto con un precio." },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
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

  const pctRaw = body.deposit_pct ?? (vendorRow as { deposit_default_pct?: number | null }).deposit_default_pct ?? 30;
  const pct = Number(pctRaw);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    return NextResponse.json({ error: "La seña debe estar entre 1 y 100" }, { status: 400 });
  }
  const amount = Math.round(Number(quote.quoted_price) * (pct / 100) * 100) / 100;
  if (!(amount > 0)) {
    return NextResponse.json({ error: "Monto de seña inválido" }, { status: 400 });
  }

  const mpToken = await getVendorMpToken(vendorRow);
  if (!mpToken) {
    return NextResponse.json(
      { error: "Conectá tu Mercado Pago desde el panel para cobrar seña online", code: "vendor_not_connected" },
      { status: 409 }
    );
  }

  const externalReference = `portal659_sena_${quote.id}_${Date.now()}`;
  try {
    const preference = {
      items: [
        {
          title: `Seña ${pct}% — ${vendorRow.store_name} (${quote.customer_name})`,
          unit_price: amount,
          quantity: 1,
          currency_id: "ARS",
        },
      ],
      metadata: { vendor_id: gate.vendor.id, quote_id: quote.id, kind: "service_deposit" },
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
      console.warn(`[MP sena] FAIL status=${res.status} vendor=${gate.vendor.id} message=${data.message || data.error || "sin detalle"}`);
      return NextResponse.json({ error: data.message || "Error al crear preferencia" }, { status: 500 });
    }
    const isTest = mpToken.startsWith("TEST-");
    const initPoint = isTest && data.sandbox_init_point ? data.sandbox_init_point : data.init_point;

    await query(
      `UPDATE quotes SET deposit_amount = $1, deposit_pct = $2, deposit_status = 'pending', mp_payment_id = NULL WHERE id = $3`,
      [amount, pct, quote.id]
    ).catch(async () => {
      // Columnas de seña aún no migradas: al menos guardar el precio ya está.
      await query(`UPDATE quotes SET quoted_price = $1 WHERE id = $2`, [quote.quoted_price, quote.id]).catch(() => {});
      throw new Error("Falta aplicar la migración migrate-service-oficios.sql en la base");
    });

    console.log(`[MP sena] ok quote=${quote.id} vendor=${gate.vendor.id} amount=${amount} pct=${pct}`);
    return NextResponse.json({ initPoint, amount, pct, sandbox: isTest });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error de conexión con Mercado Pago";
    const status = msg.startsWith("Falta aplicar") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
