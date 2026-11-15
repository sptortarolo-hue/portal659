import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"],
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
        // ============================================================
        // Cabeceras de seguridad (verificadas por scripts/check-security.mjs).
        // El CSP va en Report-Only a propósito: los reportes caen en
        // /api/csp-report → [API:csp-report] en `docker logs`. Después de una
        // semana sin violaciones reales, renombrar la cabecera a
        // "Content-Security-Policy" para hacerla obligatoria.
        // ============================================================
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Solo se respetan por HTTPS (por HTTP el navegador las ignora).
          // Sin preload a propósito: activarlo es irreversible hasta que
          // todos los subdominios sirvan HTTPS limpio.
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          // geolocation=(self): el repartidor comparte ubicación desde el
          // navegador (delivery-board). El resto de las features no listadas
          // quedan con el default (permitidas).
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
          {
            key: "Content-Security-Policy-Report-Only",
            value: [
              "default-src 'self'",
              "img-src 'self' data: blob: https:",
              "media-src 'self' blob:",
              // 'unsafe-inline': los scripts pre-paint del layout (tema, panel-ui)
              // son inline; quitarlos (nonce/hash) es trabajo de la fase enforce.
              // 'unsafe-eval' solo se necesita en dev, se quita al enforzar.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self' data:",
              "connect-src 'self'",
              "worker-src 'self' blob:",
              "manifest-src 'self'",
              "frame-ancestors 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "report-uri /api/csp-report",
            ].join("; "),
          },
        ],
      },
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
      { source: "/og/promo/:slug.jpg", destination: "/api/share/promo/:slug" },
      { source: "/og/giftcard/:code.jpg", destination: "/api/share/giftcard/:code" },
    ];
  },
};

export default nextConfig;