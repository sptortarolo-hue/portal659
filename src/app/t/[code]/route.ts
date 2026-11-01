import { NextResponse } from "next/server";
import { findScreenByShortCode, hasTvScreens } from "@/lib/tv-data";
import { getSiteUrl } from "@/lib/site-url";

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

  // URL absoluta con getSiteUrl(): en producción SIEMPRE el dominio online.
  // El host de la request NO sirve acá: detrás de nginx el redirect salía con
  // `localhost:3000` y la tele no encontraba la carta.
  const target = new URL(`/pantalla/${screen.token}`, getSiteUrl(request));
  return NextResponse.redirect(target, 307);
}
