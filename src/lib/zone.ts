import { cookies } from "next/headers";
import { ACTIVE_NEIGHBORHOODS, DEFAULT_NEIGHBORHOOD, ZONE_COOKIE } from "./config";

/** Devuelve el slug de barrio seleccionado, validando que sea activo. */
export async function getZoneSlug(): Promise<string> {
  const store = await cookies();
  const zone = store.get(ZONE_COOKIE)?.value;
  if (zone && ACTIVE_NEIGHBORHOODS.some((n) => n.slug === zone)) {
    return zone;
  }
  return DEFAULT_NEIGHBORHOOD.slug;
}

/** Devuelve el nombre del barrio seleccionado. */
export async function getZoneName(): Promise<string> {
  const slug = await getZoneSlug();
  return ACTIVE_NEIGHBORHOODS.find((n) => n.slug === slug)?.name || DEFAULT_NEIGHBORHOOD.name;
}

/** Devuelve el array de slugs para filtrar (el barrio seleccionado + sus alternativas). */
export async function getZoneSlugs(): Promise<string[]> {
  return [await getZoneSlug()];
}

/** Objeto zona completo para metadata/títulos. */
export async function getZone(): Promise<{ slug: string; name: string; slugs: string[] }> {
  const slug = await getZoneSlug();
  const name = ACTIVE_NEIGHBORHOODS.find((n) => n.slug === slug)?.name || DEFAULT_NEIGHBORHOOD.name;
  return { slug, name, slugs: [slug] };
}