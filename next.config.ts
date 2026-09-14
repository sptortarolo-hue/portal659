import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["*"],
  images: {
    // Las subidas se guardan con URL absoluta (getSiteUrl): para next/image
    // eso es "remoto" aunque sea el mismo servidor. Sin esto, 400.
    // Se permiten http y https porque el .env del VPS puede tener cualquiera.
    remotePatterns: [
      { protocol: "https", hostname: "www.portal659.com.ar" },
      { protocol: "http", hostname: "www.portal659.com.ar" },
      { protocol: "https", hostname: "portal659.com.ar" },
      { protocol: "http", hostname: "portal659.com.ar" },
      { protocol: "http", hostname: "localhost" },
    ],
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      // Tarjetas og:image con "extensión de archivo": Cloudflare solo cachea
      // por defecto URLs que terminan en .jpg/.png/... — esto hace que la
      // tarjeta de cada comercio quede 24hs en el edge (WhatsApp la descarga
      // al instante en vez de esperar el render del VPS). La query
      // (?preview=token) pasa intacta al destino.
      { source: "/og/tienda/:slug.jpg", destination: "/api/share/tienda/:slug" },
    ];
  },
};

export default nextConfig;