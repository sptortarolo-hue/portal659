import { getPool } from "@/lib/db";
import { findScreenByToken } from "@/lib/tv-data";

export const dynamic = "force-dynamic";

/**
 * SSE de la Pantalla TV: avisa cuando cambia la versión publicada (el comercio
 * tocó "Publicar") o el heartbeat propio. El cliente recarga el snapshot.
 *
 * Fallback: si el navegador del TV o el proxy no soportan SSE, el reproductor
 * tiene polling de 30s. Nunca es el único camino.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const screen = await findScreenByToken(token);
  if (!screen) {
    return new Response("no encontrada", { status: 404 });
  }

  const encoder = new TextEncoder();
  let lastVersion = Number(screen.version ?? 0);
  let lastSeen = new Date().toISOString();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ version: lastVersion })}\n\n`));

      const tick = async () => {
        if (closed) return;
        try {
          const { rows } = await getPool().query(
            `SELECT version, last_seen_at FROM tv_screens WHERE token = $1 LIMIT 1`,
            [token]
          );
          const row = rows[0];
          if (!row) {
            controller.enqueue(encoder.encode(`:gone\n\n`));
            return;
          }
          if (Number(row.version) !== lastVersion) {
            lastVersion = Number(row.version);
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ version: lastVersion })}\n\n`));
          }
          const seen = row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null;
          if (seen && seen !== lastSeen) {
            lastSeen = seen;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ping: seen })}\n\n`));
          }
          controller.enqueue(encoder.encode(`:ping\n\n`));
        } catch {
          try {
            controller.enqueue(encoder.encode(`:ping\n\n`));
          } catch {
            /* stream cerrado */
          }
        }
      };

      const poll = setInterval(tick, 5000);
      const keep = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`:keepalive\n\n`));
        } catch {
          /* cerrado */
        }
      }, 15000);

      request.signal.addEventListener("abort", () => {
        closed = true;
        clearInterval(poll);
        clearInterval(keep);
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
