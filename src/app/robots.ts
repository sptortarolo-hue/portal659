import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.portal659.com.ar").replace(/\/$/, "");

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/vendor/", "/admin/", "/mis-pedidos", "/login", "/register"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}