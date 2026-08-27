import type { MetadataRoute } from "next";
import { queryMany } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.portal659.com.ar").replace(/\/$/, "");

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/buscar`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/mapa`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${base}/barrio`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/planes`, changeFrequency: "monthly", priority: 0.6 },
  ];

  const vendors = await queryMany<{ slug: string; created_at: string }>(
    `SELECT slug, created_at FROM vendors ORDER BY created_at DESC`
  );

  const storeRoutes: MetadataRoute.Sitemap = (vendors || []).map((v) => ({
    url: `${base}/tienda/${v.slug}`,
    lastModified: v.created_at,
    changeFrequency: "daily",
    priority: 0.9,
  }));

  return [...staticRoutes, ...storeRoutes];
}