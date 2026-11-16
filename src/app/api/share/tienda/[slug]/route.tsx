import { ImageResponse } from "next/og";
import type { ReactElement } from "react";
import { queryOne } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-url";
import { isPreviewTokenValid } from "@/lib/preview";
import { coverJpegDataUri, squareJpegDataUri } from "@/lib/share-image";

export const runtime = "nodejs";

const W = 1200;
const H = 630;

/**
 * next/og SIEMPRE emite PNG — y el PNG de una foto real pesa ~500KB, por
 * encima del límite práctico de WhatsApp (~300KB) y tarda segundos en
 * generarse por request (su crawler corta la preview). Solución: convertir a
 * JPEG (sharp, 50–120KB) y cachear en el edge de Cloudflare.
 *
 * La caché es corta a propósito (1h): la URL de la imagen ya viene
 * versionada por el micrositio (`?v=<huella de la foto>`), así que al cambiar
 * la portada el comercio pide una URL nueva y WhatsApp la vuelve a bajar.
 * `?preview=token` queda en la cache key: cada comercio oculto tiene su
 * propia tarjeta con la cinta MODO PRUEBA.
 */
async function ogJpeg(element: ReactElement): Promise<Response> {
  const res = new ImageResponse(element, { width: W, height: H });
  const png = Buffer.from(await res.arrayBuffer());
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp(png)
    .flatten({ background: "#111111" }) // el JPEG no tiene alpha
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

// Tarjeta de compartir (og:image) del micrositio: fondo = foto del local,
// logo + nombre + leyenda. Al pegar el link en WhatsApp se ve esta imagen.
// Acepta ?preview=<token> para comercios hidden (misma autorización que el
// micrositio en prueba); la tarjeta sale con cinta "MODO PRUEBA".
// Para private: genera tarjeta normal SIN cinta MODO PRUEBA.
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
    visibility: "hidden" | "private" | "public" | null;
    preview_token: string | null;
    preview_token_expires_at: string | null;
  }>(
    `SELECT store_name, image_url, logo_url, description, visibility, preview_token, preview_token_expires_at FROM vendors WHERE slug = $1 LIMIT 1`,
    [slug]
  );

  if (!vendor) {
    return new Response("Not found", { status: 404 });
  }

  const vis = vendor.visibility ?? "hidden";
  const isPreview = vis === "hidden";
  if (isPreview && !isPreviewTokenValid(vendor, previewParam)) {
    return new Response("Not found", { status: 404 });
  }

  // Campos fijos (el narrowing de `vendor` no propaga a closures).
  const storeName = vendor.store_name;
  const imageUrl = vendor.image_url;
  const logoUrl = vendor.logo_url;
  const description = vendor.description;

  const siteUrl = getSiteUrl();
  const legend = description || `Pedí por WhatsApp — Portal 659 · 0% comisión`;

  /**
   * La foto y el logo van SIEMPRE embebidos (JPEG data URI) y recortados en
   * servidor:
   *  - resvg no dibuja WebP/AVIF (los dejaba en blanco sin error);
   *  - el recorte "cover" de satori es siempre centrado y en una foto
   *    vertical cortaba la parte vacía (la pared) en vez del local;
   *  - leerlas del disco (UPLOAD_DIR) evita el hairpin VPS→Cloudflare→VPS.
   * Si alguna falla, la tarjeta sale igual (con lo que haya) en vez de caer
   * al fallback pelado: antes una foto que no se pudo bajar dejaba la
   * tarjeta sin foto Y sin logo.
   */
  const [photo, logo] = await Promise.all([
    coverJpegDataUri(imageUrl, W, H),
    squareJpegDataUri(logoUrl, 400),
  ]);
  if (!photo && imageUrl) {
    console.error("[share] no se pudo usar la foto de portada", { slug });
  }

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
              alignSelf: "flex-start",
            }}
          >
            {siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")} · Pedí directo por WhatsApp
          </div>
        </div>
      </div>
    );
  }

  // Fondo: la foto del local embebida (encuadrada) o, si no hay, un
  // gradiente limpio. Antes el logo se usaba de fondo cuando faltaba la
  // portada (quedaba estirado y sin sentido).
  // OJO: satori revienta con `undefined` en los estilos → el `background` se
  // agrega sólo cuando corresponde (nunca queda la clave con undefined).
  //
  // El root NO lleva padding: en satori los hijos absolutos se posicionan
  // respecto de la caja de contenido (con padding quedaban bandas negras a
  // los lados). El padding va en el bloque de texto.
  const rootStyle: Record<string, unknown> = {
    width: W,
    height: H,
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    alignItems: "flex-start",
    position: "relative",
    fontFamily: "system-ui, sans-serif",
  };
  if (!photo) {
    rootStyle.background = "linear-gradient(135deg, #4f46e5 0%, #7c3aed 55%, #a855f7 100%)";
  }

  return ogJpeg(
    (
      <div style={rootStyle}>
        {/* Foto del local (ya recortada a 1200x630) */}
        {photo && (
          <img
            src={photo}
            width={W}
            height={H}
            style={{ position: "absolute", left: 0, top: 0, width: W, height: H, objectFit: "cover" }}
          />
        )}
        {/* Degradé para legibilidad (la foto ahora sí se ve: sin esto el
            texto se pierde en las fotos claras del local) */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: W,
            height: H,
            background:
              "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.12) 100%)",
          }}
        />
        {ribbon()}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 24,
            padding: "48px 56px",
          }}
        >
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
}
