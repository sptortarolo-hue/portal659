import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { signAccessToken, signRefreshToken, signPending2faToken, setAuthSessionCookies } from "@/lib/auth";
import { getSiteUrl } from "@/lib/site-url";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const type = url.searchParams.get("type");
  // En prod la app corre detrás de nginx y request.url trae el origen
  // interno (localhost:3000): usar el dominio canónico para que los
  // redirects lleguen al navegador del usuario (ver getSiteUrl).
  const origin = getSiteUrl(request);

  if (!token) {
    return NextResponse.redirect(`${origin}/login?error=missing_token`);
  }

  if (type === "magic") {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const profile = await queryOne<{ id: string; email: string; role: string; token_version: number; is_admin: boolean; totp_enabled: boolean }>(
      `SELECT id, email, role, token_version, is_admin, COALESCE(totp_enabled, false) AS totp_enabled FROM profiles WHERE magic_token_hash = $1 AND magic_token_expires > now() LIMIT 1`,
      [tokenHash]
    );
    if (!profile) {
      return NextResponse.redirect(`${origin}/login?error=invalid_token`);
    }

    await queryOne(
      `UPDATE profiles SET magic_token_hash = NULL, magic_token_expires = NULL WHERE id = $1 RETURNING id`,
      [profile.id]
    );

    // 2FA: si el admin tiene segundo factor, no se crea la sesión: se redirige
    // al login con un token pendiente que requiere el código TOTP.
    if (profile.is_admin && profile.totp_enabled) {
      const pendingToken = await signPending2faToken({ id: profile.id, tokenVersion: profile.token_version });
      return NextResponse.redirect(`${origin}/login?pending=${encodeURIComponent(pendingToken)}`);
    }

    const accessToken = await signAccessToken({ id: profile.id, email: profile.email, role: profile.role, tokenVersion: profile.token_version });
    const refreshToken = await signRefreshToken({ id: profile.id, email: profile.email, role: profile.role, tokenVersion: profile.token_version });
    const response = NextResponse.redirect(origin);
    // Access (7d) + refresh (30d): el panel renueva solo con /api/auth/refresh.
    setAuthSessionCookies(response, accessToken, refreshToken);
    return response;
  }

  if (type === "signup") {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const profile = await queryOne<{ id: string }>(
      `SELECT id FROM profiles WHERE confirm_token_hash = $1 AND confirm_token_expires > now() LIMIT 1`,
      [tokenHash]
    );
    if (!profile) {
      return NextResponse.redirect(`${origin}/login?error=invalid_confirmation`);
    }

    await queryOne(
      `UPDATE profiles SET email_confirmed = true, confirm_token_hash = NULL, confirm_token_expires = NULL WHERE id = $1 RETURNING id`,
      [profile.id]
    );

    return NextResponse.redirect(`${origin}/verificado`);
  }

  return NextResponse.redirect(`${origin}/login?error=invalid_type`);
}
