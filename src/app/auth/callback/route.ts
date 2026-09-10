import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { signAccessToken } from "@/lib/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const type = url.searchParams.get("type");
  const origin = url.origin;

  if (!token) {
    return NextResponse.redirect(`${origin}/login?error=missing_token`);
  }

  if (type === "magic") {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const profile = await queryOne<{ id: string; email: string; role: string }>(
      `SELECT id, email, role FROM profiles WHERE magic_token_hash = $1 AND magic_token_expires > now() LIMIT 1`,
      [tokenHash]
    );
    if (!profile) {
      return NextResponse.redirect(`${origin}/login?error=invalid_token`);
    }

    await queryOne(
      `UPDATE profiles SET magic_token_hash = NULL, magic_token_expires = NULL WHERE id = $1 RETURNING id`,
      [profile.id]
    );

    const accessToken = await signAccessToken({ id: profile.id, email: profile.email, role: profile.role });
    const response = NextResponse.redirect(origin);
    const isLocal = process.env.NODE_ENV === "development";
    const opts = { httpOnly: true, secure: !isLocal, sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 24 * 7, ...(!isLocal && { domain: ".portal659.com.ar" }) };
    // NOTA: no agregar segundo set() con el mismo nombre (ResponseCookies pisa
    // por nombre y rompería la sesión; ver login/route.ts).
    response.cookies.set("sb-access-token", accessToken, opts);
    response.cookies.set("sb-refresh-token", accessToken, opts);
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
