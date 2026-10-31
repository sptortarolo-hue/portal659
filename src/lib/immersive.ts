/**
 * Rutas "immersivas": pantallas que se muestran a pantalla completa dentro
 * del navegador del televisor (la Pantalla TV del comercio).
 *
 * No son páginas del portal: no deben heredar la navegación, el footer, el
 * overlay de bienvenida, el carrito ni el botón de WhatsApp del layout raíz.
 *
 * El criterio es por prefijo de pathname (mismo valor que devuelve
 * `usePathname()`), así que alcanza con un `startsWith`.
 */
export const IMMERSIVE_ROUTE_PREFIX = "/pantalla";

export function isImmersivePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return (
    pathname === IMMERSIVE_ROUTE_PREFIX ||
    pathname.startsWith(`${IMMERSIVE_ROUTE_PREFIX}/`)
  );
}
