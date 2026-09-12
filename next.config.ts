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
};

export default nextConfig;