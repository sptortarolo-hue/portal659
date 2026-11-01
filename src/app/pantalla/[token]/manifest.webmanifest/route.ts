import { queryOne } from "@/lib/db";
import { findScreenByToken, hasTvScreens } from "@/lib/tv-data";

export const dynamic = "force-dynamic";

/**
 * MANIFEST PROPIO DE CADA PANTALLA (`/pantalla/<token>/manifest.webmanifest`).
 *
 * ¿Por qué no sirve el manifest del portal (`/manifest.json`)? Porque su
 * `start_url` es "/" y su orientation es "portrait": si el comerciante
 * instala la carta desde Chrome en la tele, el ícono que queda en el home
 * abriría el PORTAL, no la carta. Con este manifest propio:
 *
 * - `start_url` apunta a la carta de ese token → el ícono abre la carta.
 * - `display: fullscreen` → sin barra de direcciones ni barra de Android.
 * - `orientation: landscape` → la carta está diseñada en horizontal.
 *
 * Es lo que hace que "instalar la carta como app" funcione en un Android TV
 * (Chrome: menú ⋮ → "Instalar app" / "Agregar a pantalla de inicio").
 *
 * Chrome exige: manifest con nombre, íconos 192+512, `start_url` y un service
 * worker con fetch handler (el del portal cumple: se registra en el layout
 * raíz y controla todo el dominio).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const ready = await hasTvScreens().catch(() => false);
  if (!ready) return new Response("{}", { status: 404 });

  const screen = await findScreenByToken(token);
  if (!screen) return new Response("{}", { status: 404 });

  const vendor = await queryOne<any>(`SELECT store_name FROM vendors WHERE id = $1 LIMIT 1`, [screen.vendor_id]).catch(
    () => null
  );
  const storeName = String(vendor?.store_name ?? "").trim() || "Portal 659";

  const manifest = {
    id: `/pantalla/${token}`,
    name: `${storeName} — Carta TV`,
    short_name: "Carta TV",
    description: `La carta de ${storeName} en tu televisor.`,
    start_url: `/pantalla/${token}`,
    // Scope "/" (no el de la pantalla): el service worker del portal está
    // registrado en la raíz y Chrome exige que controle el start_url.
    scope: "/",
    display: "fullscreen",
    display_override: ["fullscreen", "standalone"],
    orientation: "landscape",
    background_color: "#000000",
    theme_color: "#000000",
    categories: ["food", "business", "shopping"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };

  return new Response(JSON.stringify(manifest), {
    headers: {
      "Content-Type": "application/manifest+json; charset=utf-8",
      // Sin cache: si el token rota, el manifest tiene que cambiar.
      "Cache-Control": "no-store",
    },
  });
}
