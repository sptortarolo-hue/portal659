import { findScreenByToken, pushRemoteCommand, screenConnection } from "@/lib/tv-data";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * MANDO A DISTANCIA: el celular le pide a la tele que muestre una pantalla.
 *
 * El comando se escribe en la fila de la pantalla destino y en todas las
 * pantallas del comercio (la tele puede estar mostrando cualquiera de ellas).
 * El SSE de cada pantalla (que ya consulta la DB cada 5s) lo empuja y el
 * reproductor cambia solo de carta.
 *
 * Sin auth: el token de la URL ya identifica la pantalla y la carta es
 * pública. Lo único que se protege es el rate-limit (por IP) para que no
 * sirva de martillo: cada request escribe en la DB, así que el límite en
 * memoria (10/min) es el que manda; el de Upstash es el complemento cuando
 * está configurado.
 */
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_HITS = 10;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 1000) hits.delete(hits.keys().next().value as string);
  return arr.length > MAX_HITS;
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
  if (rateLimited(ip)) {
    return Response.json({ ok: false, error: "Demasiados intentos. Probá en un minuto." }, { status: 429 });
  }
  const { allowed } = await checkRateLimit(`tv-remote:${ip}`, 10).catch(() => ({ allowed: true }));
  if (!allowed) {
    return Response.json({ ok: false, error: "Demasiados intentos. Probá en un minuto." }, { status: 429 });
  }

  const screen = await findScreenByToken(token);
  if (!screen) {
    return Response.json({ ok: false, error: "Pantalla no encontrada" }, { status: 404 });
  }

  const pushed = await pushRemoteCommand(screen.vendor_id, token);
  if (pushed < 0) {
    // Sin migrate-tv-remote.sql: la app sigue andando, pero no el mando.
    return Response.json(
      {
        ok: false,
        code: "migration_missing",
        error: "El mando a distancia necesita la migración migrate-tv-remote.sql",
      },
      { status: 503 }
    );
  }

  const conn = await screenConnection(token);
  return Response.json(
    {
      ok: true,
      pushed,
      connected: conn.connected,
      message: conn.connected
        ? "Enviado. La tele cambia en los próximos segundos."
        : "Enviado. La tele lo va a tomar cuando se abra el link.",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
