import { ImageResponse } from "next/og";
import { queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";

export const runtime = "nodejs";

// Tarjeta de compartir (og:image) del micrositio: banner + logo + nombre + leyenda.
// Al pegar el link en WhatsApp se ve esta imagen con el comercio.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const vendor = await queryOne<{
    store_name: string;
    image_url: string | null;
    logo_url: string | null;
    description: string | null;
  }>(
    `SELECT store_name, image_url, logo_url, description FROM vendors WHERE slug = $1 AND visible = true LIMIT 1`,
    [slug]
  );

  if (!vendor) {
    return new Response("Not found", { status: 404 });
  }

  const siteUrl = getSiteUrl();
  const banner = vendor.image_url || vendor.logo_url || null;
  const logo = vendor.logo_url || null;
  const legend = vendor.description || `Pedí por WhatsApp — Portal 659 · 0% comisión`;

  const W = 1200;
  const H = 630;

  // Fondo: imagen del banner si existe (remota), con degradé arriba para texto.
  const backgroundImage = banner
    ? `url(${banner})`
    : `linear-gradient(135deg, #4f46e5 0%, #7c3aed 55%, #a855f7 100%)`;

  return new ImageResponse(
    (
      <div
        style={{
          width: W,
          height: H,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          alignItems: "flex-start",
          padding: "48px 56px",
          backgroundImage,
          backgroundSize: "cover",
          backgroundPosition: "center",
          position: "relative",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Degradé para legibilidad */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.25) 55%, rgba(0,0,0,0) 100%)",
          }}
        />
        <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 24 }}>
          {logo && (
            <img
              src={logo}
              width={160}
              height={160}
              style={{ borderRadius: 999, objectFit: "cover", border: "4px solid rgba(255,255,255,0.9)" }}
            />
          )}
          <div style={{ display: "flex", flexDirection: "column", color: "#fff" }}>
            <div style={{ fontSize: 52, fontWeight: 800, lineHeight: 1.05, maxWidth: 900 }}>
              {vendor.store_name}
            </div>
            <div style={{ fontSize: 26, marginTop: 10, opacity: 0.92, maxWidth: 880 }}>
              {legend}
            </div>
            <div
              style={{
                marginTop: 20,
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 22,
                fontWeight: 600,
                background: "rgba(255,255,255,0.16)",
                padding: "10px 18px",
                borderRadius: 999,
                width: "fit-content",
              }}
            >
              🛍️ {siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")} · Pedí directo por WhatsApp
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: W,
      height: H,
    }
  );
}