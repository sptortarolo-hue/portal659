import { touchScreen } from "@/lib/tv-data";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Heartbeat de la pantalla: la TV pega cada 60s y el panel muestra
 * "conectada / sin señal". Sin auth (el token de la URL ya identifica la
 * pantalla) y con rate-limit por IP para que no se pueda usar de martillo.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
  const { allowed } = await checkRateLimit(`tv-ping:${ip}`, 6).catch(() => ({ allowed: true }));
  if (!allowed) return Response.json({ ok: false }, { status: 429 });

  const clientVersion = request.headers.get("x-tv-client");
  const done = await touchScreen(token, clientVersion);
  if (!done) return Response.json({ ok: false }, { status: 404 });

  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
