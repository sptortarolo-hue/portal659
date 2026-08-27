import { queryMany } from "@/lib/db";
import { VERTICALS } from "@/lib/config";
import { MapPageClient } from "@/components/map/map-page-client";
import { getZone } from "@/lib/zone";
import type { Vendor } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function MapaPage() {
  const zone = await getZone();
  const vendors = await queryMany<Vendor>(
    `SELECT * FROM vendors WHERE neighborhood = $1 ORDER BY store_name`,
    [zone.slug]
  );

  const vendorsWithCoords = vendors.filter(
    (v) => v.location && v.location.trim() !== ""
  );

  return (
    <MapPageClient
      vendors={vendors}
      vendorsWithCoords={vendorsWithCoords}
      verticals={VERTICALS.map((v) => ({
        slug: v.slug,
        name: v.name,
        emoji: v.emoji,
        hex: v.hex,
      }))}
    />
  );
}
