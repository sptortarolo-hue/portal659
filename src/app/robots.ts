import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.portal659.com.ar").replace(/\/$/, "");

  // Solo se bloquean áreas privadas de la app (ahorro de crawl). Las páginas
  // públicas sin valor de indexación (checkout, tokens de seguimiento, etc.)
  // llevan `noindex` por meta, que es lo que efectivamente las desindexa —
  // bloquearlas acá impediría que Google vea ese noindex.
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/vendor/", "/admin/", "/preview/"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
