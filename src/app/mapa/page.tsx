import { getSupabase } from "@/lib/supabase";
import { ZONE, VERTICALS } from "@/lib/config";
import { MapPageClient } from "@/components/map/map-page-client";
import type { Vendor } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function MapaPage() {
  const supabase = getSupabase();

  let vendors: Vendor[] = [];

  if (supabase) {
    const { data } = await supabase
      .from("vendors")
      .select("*")
      .in("neighborhood", ZONE.slugs)
      .order("store_name");

    vendors = (data as Vendor[]) || [];
  }

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
