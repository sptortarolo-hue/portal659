import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { query } from "@/lib/db";

/**
 * Cierra la sesión en TODOS los dispositivos: incrementa token_version del
 * perfil, lo que invalida todos los JWT emitidos hasta ahora (ver getAuthUser).
 */
export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  await query(`UPDATE profiles SET token_version = token_version + 1 WHERE id = $1`, [user.id]);

  const response = NextResponse.json({ ok: true });
  const isLocal = process.env.NODE_ENV === "development";
  const clearOpts = { httpOnly: true, path: "/", maxAge: 0, ...(!isLocal && { domain: ".portal659.com.ar" }) };
  response.cookies.set("sb-access-token", "", clearOpts);
  response.cookies.set("sb-refresh-token", "", clearOpts);
  if (!isLocal) {
    // Variante host-only legacy: va como header crudo porque cookies.set()
    // pisa por nombre (ver logout/route.ts).
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
