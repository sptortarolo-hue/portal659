import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { verifyPassword, signAccessToken } from "@/lib/auth";
import { withRateLimit } from "@/lib/api-wrapper";

function normalizePhone(input: string): string {
  return (input || "").replace(/\D/g, "").trim();
}

// Login del repartidor: teléfono + contraseña.
// Solo entra si su vínculo está activo (status='active').
export const POST = withRateLimit(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const phone = normalizePhone(String(body.phone ?? ""));
  const password = String(body.password ?? "");

  if (!phone || !password) {
    return NextResponse.json({ error: "Teléfono y contraseña son requeridos" }, { status: 400 });
  }

  const staff = await queryOne<{
    id: string;
    profile_id: string;
    vendor_id: string;
    password_hash: string | null;
    email: string | null;
    status: string;
    token_version: number;
  }>(
    `SELECT vs.id, vs.profile_id, vs.vendor_id, p.password_hash, p.email, p.token_version, vs.status
     FROM vendor_staff vs
     JOIN profiles p ON p.id = vs.profile_id
     WHERE vs.phone = $1
     ORDER BY vs.created_at ASC
     LIMIT 1`,
    [phone]
  );

  if (!staff || staff.status !== "active" || !staff.password_hash) {
    return NextResponse.json({ error: "No sos repartidor de este comercio o te desvincularon" }, { status: 401 });
  }

  const ok = await verifyPassword(staff.password_hash, password);
  if (!ok) {
    return NextResponse.json({ error: "Teléfono o contraseña incorrectos" }, { status: 401 });
  }

  const vendor = await queryOne<{ id: string; store_name: string }>(
    `SELECT id, store_name FROM vendors WHERE id = $1 LIMIT 1`,
    [staff.vendor_id]
  );

  const accessToken = await signAccessToken({
    id: staff.profile_id,
    email: staff.email || `rep_${phone}@portal659.local`,
    role: "buyer",
    tokenVersion: staff.token_version,
  });

  const response = NextResponse.json({
    ok: true,
    vendor: { id: vendor?.id, store_name: vendor?.store_name },
  });
  const isLocal = process.env.NODE_ENV === "development";
  const cookieOpts = {
    httpOnly: true,
    secure: !isLocal,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    ...(!isLocal && { domain: ".portal659.com.ar" }),
  };
  // NOTA: no agregar segundo set() con el mismo nombre (ResponseCookies pisa
  // por nombre y rompería la sesión; ver login/route.ts).
  response.cookies.set("sb-access-token", accessToken, cookieOpts);
  response.cookies.set("sb-refresh-token", accessToken, cookieOpts);
  return response;
}, { maxRequests: 15 });