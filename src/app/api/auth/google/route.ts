import { NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/site-url";
import {
  GOOGLE_STATE_COOKIE,
  buildGoogleAuthUrl,
  getGoogleRedirectUri,
  googleStateCookieOpts,
  isGoogleAuthEnabled,
  signOAuthState,
} from "@/lib/google-auth";

// Siempre dinámico: depende de env/estado del navegador, nunca se prerenderiza.
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/google?next=/checkout
 *
 * Inicia el login con Google: state firmado (HMAC) + cookie anti-CSRF y
 * redirect a la pantalla de consentimiento. `next` solo acepta rutas
 * internas (ver safeNextPath).
 */
export async function GET(request: Request) {
  const origin = getSiteUrl(request);

  if (!isGoogleAuthEnabled()) {
    return NextResponse.redirect(`${origin}/login?error=google_disabled`);
  }

  const url = new URL(request.url);
  const state = signOAuthState(url.searchParams.get("next"));
  const redirectUri = getGoogleRedirectUri(request);

  const response = NextResponse.redirect(
    buildGoogleAuthUrl({ state, redirectUri })
  );
  response.cookies.set(GOOGLE_STATE_COOKIE, state, googleStateCookieOpts());
  return response;
}
