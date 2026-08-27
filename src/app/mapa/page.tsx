import { queryMany } from "@/lib/db";
import { ZONE, VERTICALS } from "@/lib/config";
import { MapPageClient } from "@/components/map/map-page-client";
import type { Vendor } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function MapaPage() {
  const vendors = await queryMany<Vendor>(
    `SELECT * FROM vendors WHERE neighborhood = ANY($1) ORDER BY store_name`,
    [ZONE.slugs]
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
