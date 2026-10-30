import { queryOne } from "@/lib/db";
import { buildTvSnapshot, findScreenByToken, hasTvScreens } from "@/lib/tv-data";

export const dynamic = "force-dynamic";

/**
 * Snapshot de la Pantalla TV: contenido vivo (catálogo) + configuración
 * publicada. Lo consumen la propia pantalla y el reproductor del panel.
 *
 * Sin cacheo: la TV debe ver el precio nuevo en segundos, y el snapshot es
 * chico (una carta) así que el costo es mínimo.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (!(await hasTvScreens().catch(() => false))) {
    return Response.json({ error: "Pantalla TV no disponible" }, { status: 404 });
  }

  const screen = await findScreenByToken(token);
  if (!screen) return Response.json({ error: "Pantalla no encontrada" }, { status: 404 });

  const vendor = await queryOne<any>(`SELECT * FROM vendors WHERE id = $1 LIMIT 1`, [screen.vendor_id]).catch(
    () => null
  );
  if (!vendor) return Response.json({ error: "Comercio no encontrado" }, { status: 404 });

  const snapshot = await buildTvSnapshot(screen, vendor);

  return Response.json(snapshot, {
    headers: { "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
}
