import { NextResponse } from "next/server";
import { findScreenByShortCode, hasTvScreens } from "@/lib/tv-data";

export const dynamic = "force-dynamic";

/**
 * URL CORTA de la Pantalla TV: `/t/<code>` (p. ej. `/t/k7f2`) → la carta.
 *
 * Existe por una razón muy concreta: la URL con el token largo son ~58
 * caracteres y escribirlos con el teclado del control remoto es una tortura.
 * El código corto son 4 caracteres, y en una TV con Android (o cualquier
 * navegador con teclado en pantalla) se tipea en segundos.
 *
 * Es un **route handler** (no una page) a propósito: así el server responde
 * con un **307 real** y la tele va derecho a la carta, sin renderizar el
 * layout del portal de por medio (que en una pantalla de local no sirve).
 *
 * - El 307 es temporal: si el comercio rota el token, el código corto sigue
 *   funcionando y apunta al token nuevo.
 * - Sin la migración `migrate-tv-remote.sql` no hay códigos: la ruta da 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  const ready = await hasTvScreens().catch(() => false);
  if (!ready) return new Response("No encontrada", { status: 404 });

  const screen = await findScreenByShortCode(code);
  if (!screen) return new Response("No encontrada", { status: 404 });

  // URL absoluta: el redirect tiene que llevar el dominio (la tele puede
  // estar detrás de Cloudflare, así que usamos el host de la request).
  const target = new URL(`/pantalla/${screen.token}`, request.url);
  return NextResponse.redirect(target, 307);
}
