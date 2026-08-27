import { cookies } from "next/headers";
import { ACTIVE_ZONES, DEFAULT_ZONE, ZONE_COOKIE } from "./config";

/** Devuelve la zona seleccionada, validando que sea activa. */
export async function getZone(): Promise<{
  slug: string;
  name: string;
  neighborhoods: string[];
}> {
  const store = await cookies();
  const slug = store.get(ZONE_COOKIE)?.value;
  const zone = ACTIVE_ZONES.find((z) => z.slug === slug) || DEFAULT_ZONE;
  return { slug: zone.slug, name: zone.name, neighborhoods: zone.neighborhoods };
}

/** Devuelve el slug de la zona seleccionada. */
export async function getZoneSlug(): Promise<string> {
  return (await getZone()).slug;
}

/** Devuelve el nombre de la zona seleccionada. */
export async function getZoneName(): Promise<string> {
  return (await getZone()).name;
}

/** Devuelve los slugs de barrios a filtrar (los que agrupa la zona). */
export async function getZoneSlugs(): Promise<string[]> {
  return (await getZone()).neighborhoods;
}