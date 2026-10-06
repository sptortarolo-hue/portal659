import type { MetadataRoute } from "next";
import { queryMany } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.portal659.com.ar").replace(/\/$/, "");

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/buscar`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/comercios`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/barrio`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/mapa`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${base}/planes`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/manuales`, changeFrequency: "monthly", priority: 0.4 },
  ];

  // lastModified real: alta del comercio o su producto más reciente (los
  // vendors no tienen updated_at propio; el catálogo es lo que más cambia).
  const vendors = await queryMany<{ slug: string; last_mod: string }>(
    `SELECT v.slug,
            GREATEST(v.created_at, COALESCE((
              SELECT MAX(p.created_at) FROM products p WHERE p.vendor_id = v.id
            ), v.created_at)) AS last_mod
     FROM vendors v
     WHERE v.visible = true
     ORDER BY last_mod DESC`
  );

  const storeRoutes: MetadataRoute.Sitemap = (vendors || []).map((v) => ({
    url: `${base}/tienda/${v.slug}`,
    lastModified: v.last_mod,
    changeFrequency: "daily",
    priority: 0.9,
  }));

  return [...staticRoutes, ...storeRoutes];
}
