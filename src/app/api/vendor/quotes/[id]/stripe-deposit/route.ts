import { gateRequest } from "@/lib/subscription-gate";
import { query, queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { createDepositSession, isStripeEnabled } from "@/lib/stripe-connect";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Genera el link de cobro de seña por Stripe para un presupuesto cotizado
 * (plan Oficios). Direct charge a la cuenta Stripe del comercio.
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
  if (!isStripeEnabled()) {
    return NextResponse.json(
      { error: "Los pagos online con Stripe están deshabilitados por ahora" },
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
      { error: gate.vendor.vertical === "estetica" ? "Primero cotizá la consulta con un precio." : "Primero cotizá el presupuesto con un precio." },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const vendorRow = await queryOne<{
    id: string;
    store_name: string;
    slug: string | null;
    stripe_account_id: string | null;
    deposit_default_pct: number | null;
  }>(
    `SELECT id, store_name, slug, stripe_account_id, deposit_default_pct FROM vendors WHERE id = $1 LIMIT 1`,
    [gate.vendor.id]
  ).catch(
    () =>
      queryOne<{ id: string; store_name: string; slug: string | null; stripe_account_id: string | null }>(
        `SELECT id, store_name, slug, stripe_account_id FROM vendors WHERE id = $1 LIMIT 1`,
        [gate.vendor.id]
      ) as Promise<{ id: string; store_name: string; slug: string | null; stripe_account_id: string | null; deposit_default_pct: number | null }>
  ).catch(() => undefined);
  if (!vendorRow) return NextResponse.json({ error: "Comercio no encontrado" }, { status: 404 });
  if (!vendorRow.stripe_account_id) {
    return NextResponse.json(
      { error: "Conectá tu Stripe desde el panel para cobrar seña online", code: "vendor_not_connected" },
      { status: 409 }
    );
  }

  const pctRaw = body.deposit_pct ?? vendorRow.deposit_default_pct ?? 30;
  const pct = Number(pctRaw);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
    return NextResponse.json({ error: "La seña debe estar entre 1 y 100" }, { status: 400 });
  }
  const amount = Math.round(Number(quote.quoted_price) * (pct / 100) * 100) / 100;
  if (!(amount > 0)) {
    return NextResponse.json({ error: "Monto de seña inválido" }, { status: 400 });
  }

  const siteUrl = getSiteUrl();
  const back = `${siteUrl}/tienda/${vendorRow.slug || gate.vendor.id}`;
  const created = await createDepositSession({
    stripeAccountId: vendorRow.stripe_account_id,
    amount,
    title: `Seña ${pct}% — ${vendorRow.store_name} (${quote.customer_name})`,
    metadata: { kind: "service_deposit", quote_id: quote.id, vendor_id: gate.vendor.id },
    successUrl: back,
    cancelUrl: back,
  });
  if (!created.ok) {
    return NextResponse.json({ error: created.error || "Error al crear el pago" }, { status: 500 });
  }

  try {
    await query(
      `UPDATE quotes SET deposit_amount = $1, deposit_pct = $2, deposit_status = 'pending', stripe_session_id = $3 WHERE id = $4`,
      [amount, pct, created.sessionId || null, quote.id]
    );
  } catch {
    await query(
      `UPDATE quotes SET deposit_amount = $1, deposit_pct = $2, deposit_status = 'pending' WHERE id = $3`,
      [amount, pct, quote.id]
    ).catch(async () => {
      await query(`UPDATE quotes SET quoted_price = $1 WHERE id = $2`, [quote.quoted_price, quote.id]).catch(() => {});
      throw new Error("Falta aplicar la migración migrate-service-oficios.sql en la base");
    });
  }

  return NextResponse.json({ initPoint: created.url, amount, pct, via: "stripe" });
}
