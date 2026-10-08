import { NextResponse } from "next/server";
import { queryOne } from "@/lib/db";
import { verifyPassword, signAccessToken } from "@/lib/auth";
import { withRateLimit } from "@/lib/api-wrapper";

function cookieOpts() {
  const isLocal = process.env.NODE_ENV === "development";
  return {
    httpOnly: true,
    secure: !isLocal,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    ...(!isLocal && { domain: ".portal659.com.ar" }),
  };
}

/**
 * Identificación pública del comercio para la pantalla "Soy del equipo":
 * `?store=<slug o nombre>` → { id, store_name, logo_url, slug }.
 * Son datos públicos (igual que el micrositio), sin nada sensible.
 */
export async function GET(request: Request) {
  const store = new URL(request.url).searchParams.get("store")?.trim() || "";
  if (store.length < 2) return NextResponse.json({ vendor: null });
  const vendor =
    (await queryOne<{ id: string; store_name: string; logo_url: string | null; slug: string }>(
      `SELECT id, store_name, logo_url, slug FROM vendors WHERE lower(slug) = lower($1) LIMIT 1`,
      [store]
    )) ??
    (await queryOne<{ id: string; store_name: string; logo_url: string | null; slug: string }>(
      `SELECT id, store_name, logo_url, slug FROM vendors WHERE store_name ILIKE $1 LIMIT 1`,
      [`%${store}%`]
    ));
  return NextResponse.json({ vendor: vendor ?? null });
}

// Login del equipo del local: comercio + usuario + contraseña (sin email).
// Solo entra si el vínculo está activo (status='active').
export const POST = withRateLimit(async (request: Request) => {
  const body = await request.json().catch(() => ({}));
  const store = String(body.store ?? "").trim();
  const username = String(body.username ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!store || !username || !password) {
    return NextResponse.json({ error: "Comercio, usuario y contraseña son requeridos" }, { status: 400 });
  }

  // El comercio se identifica por slug exacto (o nombre aproximado).
  const vendor =
    (await queryOne<{ id: string; store_name: string }>(
      `SELECT id, store_name FROM vendors WHERE lower(slug) = lower($1) LIMIT 1`,
      [store]
    )) ??
    (await queryOne<{ id: string; store_name: string }>(
      `SELECT id, store_name FROM vendors WHERE store_name ILIKE $1 LIMIT 1`,
      [`%${store}%`]
    ));
  if (!vendor) {
    return NextResponse.json({ error: "No encontramos ese comercio" }, { status: 404 });
  }

  const row = await queryOne<{
    profile_id: string;
    password_hash: string | null;
    email: string | null;
    status: string;
    staff_level: string | null;
    display_name: string | null;
    token_version: number;
  }>(
    `SELECT vs.profile_id, p.password_hash, p.email, vs.status, vs.staff_level,
            vs.display_name, p.token_version
     FROM vendor_staff vs
     JOIN profiles p ON p.id = vs.profile_id
     WHERE vs.vendor_id = $1 AND vs.role = 'staff' AND lower(vs.username) = $2
     LIMIT 1`,
    [vendor.id, username]
  ).catch(() => null);

  // Mensaje genérico a propósito (igual que el login normal).
  if (!row || row.status !== "active" || !row.password_hash) {
    return NextResponse.json({ error: "Comercio, usuario o contraseña incorrectos" }, { status: 401 });
  }
  if (!(await verifyPassword(password, row.password_hash))) {
    return NextResponse.json({ error: "Comercio, usuario o contraseña incorrectos" }, { status: 401 });
  }

  const accessToken = await signAccessToken({
    id: row.profile_id,
    email: row.email || `equipo@${vendor.id}.local`,
    role: "vendor",
    tokenVersion: row.token_version,
  });

  const response = NextResponse.json({
    ok: true,
    session: { access_token: accessToken, refresh_token: accessToken },
    vendor: { id: vendor.id, store_name: vendor.store_name },
    staff: { level: row.staff_level || "empleado", name: row.display_name },
  });
  response.cookies.set("sb-access-token", accessToken, cookieOpts());
  response.cookies.set("sb-refresh-token", accessToken, cookieOpts());
  return response;
}, { maxRequests: 15 });
