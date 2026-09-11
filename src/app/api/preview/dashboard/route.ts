import { queryOne } from "@/lib/db";
import { isPreviewTokenValid } from "@/lib/preview";
import {
  PREVIEW_DASHBOARD_COOKIE,
  signPreviewSession,
} from "@/lib/preview-session";
import { NextResponse } from "next/server";

/**
 * Ingreso al panel con link de prueba (sin cuenta).
 * POST { token } → valida el preview token y setea la cookie de sesión.
 * DELETE → cierra la sesión de prueba.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const { token } = body as { token?: string };
  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "Token requerido" }, { status: 400 });
  }

  const vendor = await queryOne<{
    id: string;
    preview_token: string | null;
    preview_token_expires_at: string | null;
  }>(
    `SELECT id, preview_token, preview_token_expires_at FROM vendors WHERE preview_token = $1 LIMIT 1`,
    [token]
  );
  if (!vendor || !isPreviewTokenValid(vendor, token)) {
    return NextResponse.json({ error: "Link de prueba inválido o vencido" }, { status: 403 });
  }

  const session = await signPreviewSession(vendor.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PREVIEW_DASHBOARD_COOKIE, session, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 24 * 60 * 60,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PREVIEW_DASHBOARD_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
