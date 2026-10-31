import { notFound } from "next/navigation";
import { queryOne } from "@/lib/db";
import { buildTvSnapshot, findScreenByToken, hasTvScreens } from "@/lib/tv-data";
import { TvPlayer } from "@/components/tv/tv-player";

export const dynamic = "force-dynamic";

/**
 * Pantalla TV (/pantalla/[token]): la carta del comercio en un televisor.
 *
 * - URL pública por TOKEN por pantalla (no adivinable, regenerable desde el
 *   panel): no requiere login, ni cookies, ni carrito. Es una pantalla de
 *   local, no una página de navegación.
 * - El contenido (precios, fotos, agotados) se lee del catálogo en cada carga;
 *   el layout sale de `tv_screens.published`.
 * - Si la migración no está aplicada, se cae a un 404 amable (nunca a un error).
 */
export default async function PantallaPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ debug?: string }>;
}) {
  const { token } = await params;
  // ?debug=1 muestra guías de área segura y estado de conexión (sirve para
  // instalar la pantalla y verificar que no se recorta nada en el TV real).
  const debug = (await searchParams)?.debug === "1";

  let ready = true;
  try {
    ready = await hasTvScreens();
  } catch {
    ready = false;
  }
  if (!ready) notFound();

  const screen = await findScreenByToken(token);
  if (!screen) notFound();

  const vendor = await queryOne<any>(`SELECT * FROM vendors WHERE id = $1 LIMIT 1`, [screen.vendor_id]).catch(
    () => null
  );
  if (!vendor) notFound();

  const snapshot = await buildTvSnapshot(screen, vendor);

  return (
    // Div (no <main>): el layout raíz ya envuelve en <main> y dos <main>
    // anidados son HTML inválido. El css del layout de la ruta ya anula el
    // padding del main raíz, así que este contenedor queda a pantalla completa.
    <div className="h-screen w-screen overflow-hidden bg-black">
      <TvPlayer
        snapshot={snapshot}
        token={token}
        mode="live"
        vertical={vendor.vertical ?? null}
        debug={debug}
      />
    </div>
  );
}
