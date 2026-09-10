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
    // OJO: NO usar response.cookies.set() otra vez con el mismo nombre:
    // ResponseCookies guarda en un Map por nombre y pisaría el clear de arriba.
    // Se agrega el segundo Set-Cookie como header crudo.
    const expired = "Thu, 01 Jan 1970 00:00:00 GMT";
    response.headers.append(
      "Set-Cookie",
      `sb-access-token=; Path=/; Expires=${expired}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
    );
    response.headers.append(
      "Set-Cookie",
      `sb-refresh-token=; Path=/; Expires=${expired}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`
    );
  }
  return response;
}