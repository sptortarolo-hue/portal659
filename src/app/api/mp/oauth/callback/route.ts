import { queryOne } from "@/lib/db";
import { verifyState, exchangeCodeForTokens, encryptSecret } from "@/lib/mp-oauth";
import { getSiteUrl } from "@/lib/site-url";
import { NextResponse } from "next/server";

/**
 * GET /api/mp/oauth/callback?code=...&state=...
 * Callback de Mercado Pago tras la autorización del comercio.
 * Valida el state firmado, intercambia el code por tokens y los guarda CIFRADOS.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const dashboardUrl = (extra: string) => `${getSiteUrl(request)}/vendor/dashboard?${extra}`;

  if (!code || !state) {
    return NextResponse.redirect(dashboardUrl("mp=error"));
  }

  const verified = verifyState(state);
  if (!verified) {
    return NextResponse.redirect(dashboardUrl("mp=error&reason=state"));
  }

  const redirectUri = `${getSiteUrl(request)}/api/mp/oauth/callback`;
  const tokens = await exchangeCodeForTokens(code, redirectUri);

  if (!tokens.ok || !tokens.accessToken) {
    return NextResponse.redirect(dashboardUrl("mp=error&reason=exchange"));
  }

  // Nunca loguear el token. Solo guardamos cifrado.
  const expiresAt = new Date(Date.now() + (tokens.expiresInSec || 15552000) * 1000).toISOString();

  await queryOne(
    `UPDATE vendors
     SET mp_user_id = $1,
         mp_access_token = $2,
         mp_refresh_token = $3,
         mp_public_key = $4,
         mp_expires_at = $5,
         mp_connected_at = now()
     WHERE id = $6`,
    [
      tokens.userId ?? null,
      encryptSecret(tokens.accessToken),
      encryptSecret(tokens.refreshToken || ""),
      tokens.publicKey ?? null,
      expiresAt,
      verified.vendorId,
    ]
  );

  return NextResponse.redirect(dashboardUrl("mp=connected"));
}
