import { ImageResponse } from "next/og";
import type { ReactElement } from "react";
import { queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { isPreviewTokenValid } from "@/lib/preview";

export const runtime = "nodejs";

/**
 * next/og SIEMPRE emite PNG — y el PNG de una foto real pesa ~500KB, por
 * encima del límite práctico de WhatsApp (~300KB) y tarda segundos en
 * generarse por request (su crawler corta la preview). Solución: convertir a
 * JPEG (sharp, 50–120KB) y cachear 24hs en el edge de Cloudflare (los crawls
 * siguientes salen instantáneos). `?preview=token` queda en la cache key:
 * cada comercio oculto tiene su propia tarjeta con la cinta MODO PRUEBA.
 */
async function ogJpeg(element: ReactElement): Promise<Response> {
  const res = new ImageResponse(element, { width: 1200, height: 630 });
  const png = Buffer.from(await res.arrayBuffer());
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp(png)
    .flatten({ background: "#111111" }) // el JPEG no tiene alpha
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

// Tarjeta de compartir (og:image) del micrositio: banner + logo + nombre + leyenda.
// Al pegar el link en WhatsApp se ve esta imagen con el comercio.
// Acepta ?preview=<token> para comercios ocultos (misma autorización que el
// micrositio en prueba); la tarjeta sale con cinta "MODO PRUEBA".
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const previewParam = new URL(request.url).searchParams.get("preview");

  const vendor = await queryOne<{
    store_name: string;
    image_url: string | null;
    logo_url: string | null;
    description: string | null;
    visible: boolean;
    preview_token: string | null;
    preview_token_expires_at: string | null;
  }>(
    `SELECT store_name, image_url, logo_url, description, visible, preview_token, preview_token_expires_at FROM vendors WHERE slug = $1 LIMIT 1`,
    [slug]
  );

  if (!vendor) {
    return new Response("Not found", { status: 404 });
  }

  const isPreview = !vendor.visible;
  if (isPreview && !isPreviewTokenValid(vendor, previewParam)) {
    return new Response("Not found", { status: 404 });
  }

  // Campos fijos (el narrowing de `vendor` no propaga a closures).
  const storeName = vendor.store_name;
  const imageUrl = vendor.image_url;
  const logoUrl = vendor.logo_url;
  const description = vendor.description;

  const siteUrl = getSiteUrl();
  const banner = imageUrl || logoUrl || null;
  const logo = logoUrl;
  const legend = description || `Pedí por WhatsApp — Portal 659 · 0% comisión`;

  const W = 1200;
  const H = 630;

  function ribbon() {
    if (!isPreview) return null;
    return (
      <div
        style={{
          position: "absolute",
          top: 36,
          right: 48,
          background: "#fbbf24",
          color: "#451a03",
          fontSize: 24,
          fontWeight: 800,
          padding: "8px 20px",
          borderRadius: 999,
        }}
      >
        MODO PRUEBA
      </div>
    );
  }

  function textBlock() {
    return (
      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", color: "#fff" }}>
          <div style={{ fontSize: 52, fontWeight: 800, lineHeight: 1.05, maxWidth: 900 }}>
            {storeName}
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
            {siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")} · Pedí directo por WhatsApp
          </div>
        </div>
      </div>
    );
  }

  // Las imágenes remotas se validan ANTES de renderizar: si alguna falla,
  // se usa la tarjeta solo con gradiente (el fetch dentro de ImageResponse
  // puede fallar de forma asíncrona y tumbar toda la respuesta).
  async function remoteOk(url: string | null): Promise<boolean> {
    if (!url) return true;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return false;
      await res.arrayBuffer().catch(() => null);
      return true;
    } catch {
      return false;
    }
  }
  const [bannerOk, logoOk] = await Promise.all([remoteOk(banner), remoteOk(logo)]);
  const fullOk = bannerOk && logoOk;
  if (!fullOk) {
    console.error("[share] imagen remota no disponible, usando fallback", { slug, bannerOk, logoOk });
  }

  // Si las imágenes remotas fallan, el render completo revienta: fallback a
  // tarjeta solo con gradiente para devolver siempre una imagen válida.
  try {
    if (!fullOk) throw new Error("remote image unavailable");
    // Fondo: imagen del banner si existe (remota), con degradé arriba para texto.
    const backgroundImage = banner
      ? `url(${banner})`
      : `linear-gradient(135deg, #4f46e5 0%, #7c3aed 55%, #a855f7 100%)`;

    return ogJpeg(
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
          {ribbon()}
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 24 }}>
            {logo && (
              <img
                src={logo}
                width={160}
                height={160}
                style={{ borderRadius: 999, objectFit: "cover", border: "4px solid rgba(255,255,255,0.9)" }}
              />
            )}
            {textBlock()}
          </div>
        </div>
      )
    );
  } catch (err) {
    console.error("[share] fallo render con imágenes, usando fallback:", err);
    return ogJpeg(
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
            background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 55%, #a855f7 100%)",
            position: "relative",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {ribbon()}
          {textBlock()}
        </div>
      )
    );
  }
}