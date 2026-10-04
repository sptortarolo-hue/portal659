import { queryOne } from "@/lib/db";
import { verifyState } from "@/lib/mp-oauth";
import { exchangeStripeCode, isStripeEnabled } from "@/lib/stripe-connect";
import { getSiteUrl } from "@/lib/site-url";
import { NextResponse } from "next/server";

/**
 * GET /api/stripe/oauth/callback?code=...&state=...
 * Callback de Stripe tras la autorización del comercio. Valida el state
 * firmado, intercambia el code por la cuenta conectada y la guarda
 * (solo el account id, que no es secreto).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const dashboardUrl = (extra: string) => `${getSiteUrl(request)}/vendor/dashboard?${extra}`;

  if (!isStripeEnabled()) {
    return NextResponse.redirect(dashboardUrl("stripe=error"));
  }

  if (!code || !state) {
    return NextResponse.redirect(dashboardUrl("stripe=error"));
  }

  const verified = verifyState(state);
  if (!verified) {
    return NextResponse.redirect(dashboardUrl("stripe=error&reason=state"));
  }

  const exchanged = await exchangeStripeCode(code);
  if (!exchanged.ok || !exchanged.accountId) {
    return NextResponse.redirect(dashboardUrl("stripe=error&reason=exchange"));
  }

  // Verificar persistencia antes de festejar: sin migración el UPDATE falla
  // en silencio y el comercio creería estar conectado.
  const saved = await queryOne<{ stripe_account_id: string | null }>(
    `UPDATE vendors SET stripe_account_id = $1, stripe_connected_at = now() WHERE id = $2 RETURNING stripe_account_id`,
    [exchanged.accountId, verified.vendorId]
  ).catch(() => undefined);

  if (!saved?.stripe_account_id) {
    return NextResponse.redirect(dashboardUrl("stripe=error&reason=db"));
  }

  return NextResponse.redirect(dashboardUrl("stripe=connected"));
}
