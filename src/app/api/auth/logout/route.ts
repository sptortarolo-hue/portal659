import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  const isLocal = process.env.NODE_ENV === "development";
  const clearOpts = { httpOnly: true, path: "/", maxAge: 0, ...(!isLocal && { domain: ".portal659.com.ar" }) };
  response.cookies.set("sb-access-token", "", clearOpts);
  response.cookies.set("sb-refresh-token", "", clearOpts);
  if (!isLocal) {
    // Matar también la variante host-only legacy (sin Domain): es otra key y
    // si sobrevive la sesión "queda abierta" aunque se haga logout.
    const hostClear = { httpOnly: true, path: "/", maxAge: 0 };
    response.cookies.set("sb-access-token", "", hostClear);
    response.cookies.set("sb-refresh-token", "", hostClear);
  }
  return response;
}