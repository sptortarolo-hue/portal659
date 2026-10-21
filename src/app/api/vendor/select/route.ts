import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { ADMIN_AS_COOKIE, VENDOR_COOKIE } from "@/lib/vendor-utils";

/**
 * Selector de tienda (multi-comercio): setea la cookie
 * `portal659-vendor-id` con el comercio activo del dueño. Solo acepta
 * vendors propios (dueño); el equipo usa su propio login por local.
 *
 * Con `as: true` (solo admin, en modo llave en mano) en vez de elegir entre
 * los comercios propios alterna la cookie de impersonación
 * `portal659-admin-as` entre los comercios del dueño impersonado.
 * DELETE limpia la cookie (vuelve al primero del dueño).
 */
export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const vendorId = typeof body?.vendorId === "string" ? body.vendorId : "";
  const asAdmin = body?.as === true;
  if (!vendorId) {
    return NextResponse.json({ error: "Falta el comercio" }, { status: 400 });
  }

  const exists = await queryOne<{ id: string }>(
    `SELECT id FROM vendors WHERE id = $1 LIMIT 1`,
    [vendorId]
  );
  if (!exists) {
    return NextResponse.json({ error: "Comercio inexistente" }, { status: 404 });
  }

  const res = NextResponse.json({ ok: true, vendorId: exists.id });

  if (asAdmin) {
    if (!user.is_admin) {
      return NextResponse.json({ error: "No autorizado" }, { status: 403 });
    }
    // 2h: mismo TTL que la impersonación del dashboard.
    res.cookies.set(ADMIN_AS_COOKIE, exists.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 2,
    });
    return res;
  }

  const owned = await queryOne<{ id: string }>(
    `SELECT id FROM vendors WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [vendorId, user.id]
  );
  if (!owned) {
    return NextResponse.json({ error: "No es tu comercio" }, { status: 403 });
  }

  res.cookies.set(VENDOR_COOKIE, owned.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 60, // 60 días: sobrevive a reinicios del navegador
  });
  return res;
}

export async function DELETE(request: Request) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(VENDOR_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
